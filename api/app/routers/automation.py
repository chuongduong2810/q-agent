"""Automation generation router — Claude -> Playwright TypeScript specs.

Endpoints to implement:
  POST /runs/{run_id}/automation/generate   -> list[AutomationSpecOut]  (approved cases only)
  GET  /runs/{run_id}/automation            -> list[AutomationSpecOut]
  GET  /cases/{case_id}/spec                 -> AutomationSpecOut
  POST /cases/{case_id}/spec/regenerate      -> AutomationSpecOut

Generation writes real *.spec.ts files under workspace/specs/{run_code}/ and
persists AutomationSpec rows. Manual cases are skipped. Publishes WS progress.
"""

from __future__ import annotations

import json
import threading

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app import db as db_module
from app.config import settings
from app.db import get_db
from app.deps_auth import current_user
from app.logging import logger
from app.models.run import Run, RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas import AutomationSpecRegenerate, AutomationSpecUpdate
from app.services import (
    audit_service,
    placeholder_gate,
    playwright_runner,
    project_config_service,
    run_context,
    run_control,
    spec_examples,
    spec_service,
)
from app.services.claude_cli import ClaudeError, run_json
from app.services.ownership import get_owned_or_404
from app.services.prompts import build_automation_review_prompt
from app.services.run_status import set_run_status
from app.services.skills import AUTOMATION_REVIEWER
from app.ws import hub

router = APIRouter(tags=["automation"])

# Run ids with an in-flight generation pass — lets the UI reflect the running
# state after navigating away/back, and prevents double-triggering generation.
_generating: set[int] = set()


def is_generating(run_id: int) -> bool:
    return run_id in _generating


def _get_case_and_run_or_404(
    db: Session, case_id: int, user: User | None
) -> tuple[TestCase, Run]:
    """Resolve a test case and its owning run.

    404s when the case is missing, or when the case's run is not owned by
    ``user`` (see ``app.services.ownership.get_owned_or_404``).
    """
    case = db.get(TestCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    run = get_owned_or_404(db, Run, case.run_id, user)
    return case, run


def _eligible_cases_query(db: Session, run_id: int):
    """Approved, non-Manual test cases for a run — the automation-eligible set."""
    return (
        db.query(TestCase)
        .filter(
            TestCase.run_id == run_id,
            TestCase.approval == "approved",
            TestCase.automation != "Manual",
        )
        .order_by(TestCase.id)
    )


def _select_examples_for_case(db: Session, case: TestCase) -> list[dict]:
    """Pick up to 2 proven, already-passing specs from the SAME project + repo.

    Resolves the case's project key (via its ticket's provider) and target repo
    (via its RunTicket), then delegates to ``spec_examples.select_examples``. Purely
    best-effort grounding for generation — returns ``[]`` when nothing resolves.
    """
    ticket = db.query(Ticket).filter(Ticket.external_id == case.ticket_external_id).first()
    if ticket is None:
        return []
    project_key = project_config_service.project_key_for_ticket(db, ticket)
    if not project_key:
        return []
    run_ticket = (
        db.query(RunTicket)
        .filter(
            RunTicket.run_id == case.run_id,
            RunTicket.ticket_external_id == case.ticket_external_id,
        )
        .first()
    )
    repo = run_ticket.repo if run_ticket else ""
    return spec_examples.select_examples(db, project_key, repo, case, limit=2)


def _run_automation_review(code: str, case: TestCase, context: dict) -> dict | None:
    """Best-effort static review of a gate-passed spec via ``automation-reviewer`` (#181).

    Runs only after the deterministic placeholder/flaky-pattern gate has already
    passed a spec — this is the AI review stage that catches what regex
    heuristics can't (correctness against the case, reuse discipline, subtler
    flakiness). Additive and best-effort, matching the ``test-case-reviewer``
    wiring pattern (#173): any failure (Claude error, non-JSON response) is
    logged and skipped rather than blocking generation.

    Returns:
        The parsed ``{"verdict", "findings"}`` dict, or ``None`` if the review
        could not be obtained.
    """
    try:
        review = run_json(
            build_automation_review_prompt(code, case, context),
            skill=AUTOMATION_REVIEWER,
            label=f"Review spec: {case.ticket_external_id} {case.code}",
        )
    except Exception as exc:  # noqa: BLE001 - review is additive, best-effort
        logger.warning("Automation review skipped for case {}: {}", case.id, exc)
        return None
    return review if isinstance(review, dict) else None


def _review_critical_findings(review: dict) -> list[str]:
    """Critical-severity finding messages from an automation-reviewer verdict."""
    findings = review.get("findings")
    if not isinstance(findings, list):
        return []
    return [
        str(f.get("message", "") or "Critical finding")
        for f in findings
        if isinstance(f, dict) and str(f.get("severity", "")).strip().lower() == "critical"
    ]


def _generate_one(
    db: Session, run: Run, case: TestCase, reviewer_comment: str | None = None
) -> AutomationSpec:
    """Generate (or regenerate) and persist the AutomationSpec for one case.

    Generation is grounded with few-shot examples (proven passing specs from the
    same project) and gated by the placeholder / invented-reference / flaky-pattern
    gate plus a best-effort ``playwright --list`` parse check before the spec is
    accepted. A gate-passed spec then gets a best-effort static review from
    ``automation-reviewer`` (#181); a Critical finding flips the outcome to
    ``rejected`` just like the deterministic gate would:

    - ``passed``   -> write the file, ``status="draft"`` (runnable).
    - ``blocked``  -> save the row ``status="blocked"`` with ``block_reason``; the
                      file is NOT written, so a blocked spec never enters the
                      runnable file set.
    - ``rejected`` -> keep any previous good spec untouched (code/path/status),
                      recording the rejection in ``gate_report``. With no previous
                      spec, save ``status="blocked"`` (still not runnable).

    Args:
        db: Active session (caller commits).
        run: The owning Run (provides run.code for the spec path).
        case: The approved, non-Manual TestCase to generate a spec for.
        reviewer_comment: Optional free-text note (from a per-case regenerate)
            injected into the generation prompt as reviewer guidance. The gate
            still runs unchanged, so a comment can never bypass quality gating.

    Returns:
        The created or updated AutomationSpec row (not yet committed).
    """
    context = spec_service.build_case_context(db, case, env=run.env)
    examples = _select_examples_for_case(db, case)
    code = spec_service.generate_spec_code(
        case, context, examples=examples, reviewer_comment=reviewer_comment
    )
    filename = spec_service.spec_filename(case.ticket_external_id, case.code)

    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
    has_previous_good = bool(spec is not None and (spec.code or "").strip())
    if spec is None:
        spec = AutomationSpec(test_case_id=case.id)
        db.add(spec)
    spec.filename = filename
    spec.language = "TypeScript"
    spec.framework = "Playwright"

    # Build the KB view the gate compares against (accepts raw KB shapes directly).
    known = {
        "routes": context.get("routes", []),
        "selectors": context.get("selectors", []),
        "base_url": context.get("baseUrl", ""),
    }
    gate = placeholder_gate.gate_spec(code, known)
    outcome = gate["outcome"]
    # A spec Playwright cannot even parse/collect is treated like a rejection
    # (best-effort: an unavailable CLI/timeout skips the check, never blocks).
    if outcome == "passed" and not spec_service.playwright_list_ok(code, run.owner_id):
        outcome = "rejected"
        gate = {
            "outcome": "rejected",
            "findings": ["playwright --list parse failure"],
            "reason": "Playwright could not parse/collect the generated spec.",
            "unblock_action": "Regenerate the spec so it parses cleanly under Playwright.",
        }

    # Deterministic gate passed -> ask automation-reviewer for a static review
    # (#181). Additive: a Critical finding is treated like a gate rejection; the
    # verdict/findings are persisted in gate_report either way so they surface
    # on the automation screen. Best-effort — a failed/unparseable review never
    # blocks a spec the deterministic gate already passed.
    if outcome == "passed":
        review = _run_automation_review(code, case, context)
        if review is not None:
            gate = dict(gate)
            gate["review"] = review
            critical = _review_critical_findings(review)
            if critical or str(review.get("verdict", "")).strip().lower() == "reject":
                outcome = "rejected"
                gate["outcome"] = "rejected"
                gate["reason"] = (
                    "automation-reviewer flagged Critical findings: " + "; ".join(critical[:6])
                    if critical
                    else "automation-reviewer verdict was reject."
                )
                gate["unblock_action"] = "Address the review findings above and regenerate."

    if outcome == "blocked":
        # Missing-input: persist the generated code + reason but never write the
        # file, so a blocked spec is not part of the runnable set.
        spec.code = code
        spec.status = "blocked"
        spec.block_reason = f'{gate["reason"]} {gate["unblock_action"]}'.strip()
        spec.gate_report = json.dumps(gate)
        return spec

    if outcome == "rejected":
        spec.gate_report = json.dumps(gate)
        if has_previous_good:
            # Keep the previous good spec: leave code/path/status untouched.
            return spec
        # No previous spec to fall back on — save non-runnable, noting the rejection.
        spec.code = code
        spec.status = "blocked"
        spec.block_reason = f'Rejected: {gate["reason"]} {gate["unblock_action"]}'.strip()
        return spec

    # passed — accept and write the runnable spec file.
    path = spec_service.write_spec_file(
        run.code, case.ticket_external_id, case.code, code, run.owner_id
    )
    spec.code = code
    spec.path = str(path)
    spec.status = "draft"
    spec.block_reason = ""
    spec.gate_report = json.dumps(gate)
    return spec


def _run_generation(run_id: int, force: bool = False) -> None:
    """Background worker: generate specs for eligible cases in a run.

    Args:
        run_id: The run whose approved, non-Manual cases to generate specs for.
        force: When False (default) only cases that don't yet have an
            AutomationSpec are generated, so previously generated — and possibly
            hand-edited — specs are preserved. When True every eligible case is
            (re)generated, overwriting existing specs.
    """
    # Attribute this thread's Claude spend to the run (see run_context).
    run_context.set_run(run_id)
    db = db_module.SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run is None:
            return
        try:
            cases = _eligible_cases_query(db, run_id).all()
            if not force:
                existing_case_ids = {
                    case_id
                    for (case_id,) in db.query(AutomationSpec.test_case_id)
                    .join(TestCase, AutomationSpec.test_case_id == TestCase.id)
                    .filter(TestCase.run_id == run_id)
                    .all()
                }
                cases = [c for c in cases if c.id not in existing_case_ids]
            total = len(cases)
            cancelled = False
            for index, case in enumerate(cases, start=1):
                if run_control.is_cancelled(run_id, db):
                    logger.info("Run {} cancelled — stopping automation generation", run.code)
                    cancelled = True
                    break
                try:
                    spec = _generate_one(db, run, case)
                    db.commit()
                    hub.publish(
                        str(run_id),
                        "automation.progress",
                        {"file": spec.filename, "message": "Generated", "done": index, "total": total},
                    )
                except Exception as exc:  # noqa: BLE001 - surface per-case, never abort the pass
                    db.rollback()
                    logger.error("Automation generation failed for case {}: {}", case.id, exc)
                    hub.publish(
                        str(run_id),
                        "automation.progress",
                        {
                            "file": spec_service.spec_filename(case.ticket_external_id, case.code),
                            "message": f"Error: {exc}",
                            "done": index,
                            "total": total,
                        },
                    )
            # Flip the run to 'automation' and announce it — unless cancelled
            # mid-pass, in which case the cancel path's terminal status stands.
            if not cancelled:
                set_run_status(db, run, "automation")
        except Exception as exc:  # noqa: BLE001 - never crash the worker thread silently
            logger.error("Automation generation crashed for run {}: {}", run.code, exc)
            db.rollback()
            run.failed_stage = run.status
            set_run_status(db, run, "failed")
    finally:
        _generating.discard(run_id)
        db.close()
        run_context.clear()


@router.post("/runs/{run_id}/automation/generate")
def generate_automation(
    run_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> list[dict]:
    """Kick off automation spec generation for a run's approved, non-Manual cases.

    Runs generation in a background thread and returns the current specs list
    immediately (per contract). Sets Run.status = 'automation' once the
    background pass completes.

    Args:
        force: When False (default) only cases without an existing spec are
            generated — newly approved cases get specs while previously
            generated/edited specs are left untouched. When True every eligible
            case is regenerated, overwriting existing specs.
    """
    run = get_owned_or_404(db, Run, run_id, user)

    # Guard against double-triggering while a pass is already running.
    if run_id not in _generating:
        _generating.add(run_id)
        threading.Thread(
            target=_run_generation, args=(run_id, force), daemon=True
        ).start()
        audit_service.record(
            category="ai", actor_type="ai",
            action="Regenerated automation" if force else "Generated automation",
            target=run.code,
        )

    specs = (
        db.query(AutomationSpec)
        .join(TestCase, AutomationSpec.test_case_id == TestCase.id)
        .filter(TestCase.run_id == run_id)
        .all()
    )
    return [_spec_out(s) for s in specs]


@router.get("/runs/{run_id}/automation")
def list_automation(
    run_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[dict]:
    """List all generated automation specs for a run."""
    get_owned_or_404(db, Run, run_id, user)
    specs = (
        db.query(AutomationSpec)
        .join(TestCase, AutomationSpec.test_case_id == TestCase.id)
        .filter(TestCase.run_id == run_id)
        .all()
    )
    return [_spec_out(s) for s in specs]


@router.get("/runs/{run_id}/automation/status")
def automation_status(
    run_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Whether a generation pass is currently running for this run.

    Lets the UI restore the 'generating' state after navigating away/back and
    keep the Generate button disabled instead of re-triggering.
    """
    get_owned_or_404(db, Run, run_id, user)
    return {"generating": is_generating(run_id)}


@router.get("/cases/{case_id}/spec")
def get_case_spec(
    case_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Get the automation spec for a single test case."""
    _get_case_and_run_or_404(db, case_id, user)
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Spec not found")
    return _spec_out(spec)


@router.patch("/cases/{case_id}/spec")
def update_case_spec(
    case_id: int,
    payload: AutomationSpecUpdate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> dict:
    """Persist manual edits to a case's spec, re-gate it, and sync the .spec.ts file.

    Re-runs the placeholder / invented-reference gate on the edited code (the
    same gate generation uses), so a manual edit that removes the TODO
    placeholders **unblocks** the spec (``status="draft"``, file written, runnable)
    — and, conversely, re-introducing a placeholder re-blocks it. A still-blocked
    edit is persisted (``code``/``block_reason``) but not written to the runnable
    file set, matching :func:`_generate_one`. 404 if the case has no spec.
    """
    case, run = _get_case_and_run_or_404(db, case_id, user)
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Spec not found")

    spec.code = payload.code
    context = spec_service.build_case_context(db, case, env=run.env)
    known = {
        "routes": context.get("routes", []),
        "selectors": context.get("selectors", []),
        "base_url": context.get("baseUrl", ""),
    }
    gate = placeholder_gate.gate_spec(payload.code, known)
    outcome = gate["outcome"]
    # Mirror generation: a spec Playwright cannot parse/collect is not runnable.
    if outcome == "passed" and not spec_service.playwright_list_ok(payload.code, run.owner_id):
        outcome = "rejected"
        gate = {
            "outcome": "rejected",
            "findings": ["playwright --list parse failure"],
            "reason": "Playwright could not parse/collect the edited spec.",
            "unblock_action": "Fix the spec so it parses cleanly under Playwright.",
        }
    spec.gate_report = json.dumps(gate)

    if outcome == "passed":
        path = spec_service.write_spec_file(
            run.code, case.ticket_external_id, case.code, payload.code, run.owner_id
        )
        spec.path = str(path)
        spec.status = "draft"
        spec.block_reason = ""
    else:
        # Still not clean — keep it out of the runnable file set (don't write it).
        prefix = "Rejected: " if outcome == "rejected" else ""
        spec.status = "blocked"
        spec.block_reason = f'{prefix}{gate["reason"]} {gate["unblock_action"]}'.strip()

    db.commit()
    db.refresh(spec)
    return _spec_out(spec)


@router.post("/cases/{case_id}/spec/regenerate")
def regenerate_case_spec(
    case_id: int,
    body: AutomationSpecRegenerate = Body(default_factory=AutomationSpecRegenerate),
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> dict:
    """Synchronously regenerate the automation spec for a single test case.

    An optional free-text ``comment`` steers this one regeneration (audit-only;
    not persisted on the spec row): it is injected into the generation prompt as
    reviewer guidance, but the placeholder / invented-reference gate still runs
    unchanged — a comment can never bypass quality gating.
    """
    case, run = _get_case_and_run_or_404(db, case_id, user)
    comment = (body.comment or "").strip() or None

    # Attribute this Claude call to the run's owner so it resolves that user's
    # credential (own→shared), exactly like the bulk generator (_run_generation).
    # Without an ambient run, resolve_ambient_owner_id() returns None and the call
    # silently falls back to the *shared* credential — which 401s when the owner's
    # own credential is the valid one and the shared is missing/expired (#237).
    run_context.set_run(run.id)
    try:
        spec = _generate_one(db, run, case, reviewer_comment=comment)
    except ClaudeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        run_context.clear()
    db.commit()
    db.refresh(spec)
    audit_service.record(
        category="ai", actor_type="ai", action="Regenerated spec",
        target=f"{case.ticket_external_id} · {case.code}",
        meta=f"Comment: {comment[:500]}" if comment else "",
    )
    hub.publish(
        str(run.id),
        "automation.progress",
        {"file": spec.filename, "message": "Regenerated", "done": 1, "total": 1},
    )
    return _spec_out(spec)


@router.post("/cases/{case_id}/spec/heal")
def heal_case_spec(
    case_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Start a self-heal loop for one case: run its spec and, while it fails,
    feed the failure back to Claude to regenerate + re-run, up to a cap.

    Runs in a background thread (streams ``heal.progress`` WS events) and returns
    immediately. 409 if the run is executing or another case in the run is
    already healing (they share the run's spec dir).
    """
    case, run = _get_case_and_run_or_404(db, case_id, user)
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Generate a spec for this case first")
    if run.status == "executing":
        raise HTTPException(status_code=409, detail="Run is executing — wait for it to finish")

    if not playwright_runner.start_heal(case_id, run.id):
        raise HTTPException(
            status_code=409, detail="Another case in this run is already self-healing"
        )
    audit_service.record(
        category="ai", actor_type="ai", action="Self-healed spec",
        target=f"{case.ticket_external_id} · {case.code}",
    )
    return {"started": True, "maxAttempts": settings.heal_max_attempts}


@router.get("/cases/{case_id}/spec/heal/status")
def heal_case_spec_status(
    case_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Whether a self-heal pass is running for this case (survives navigation)."""
    _get_case_and_run_or_404(db, case_id, user)
    return playwright_runner.heal_state(case_id)


@router.get("/cases/{case_id}/spec/heal/report")
def heal_case_spec_report(
    case_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """The last self-heal trail for a case: per-attempt error, diff and outcome.

    Returns ``{}`` if the case has no spec or has never been healed.
    """
    import json as _json

    _get_case_and_run_or_404(db, case_id, user)
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None or not spec.heal_report:
        return {}
    try:
        return _json.loads(spec.heal_report)
    except _json.JSONDecodeError:
        return {}


def _spec_out(spec: AutomationSpec) -> dict:
    return {
        "id": spec.id,
        "testCaseId": spec.test_case_id,
        "filename": spec.filename,
        "language": spec.language,
        "framework": spec.framework,
        "code": spec.code,
        "status": spec.status,
        "blockReason": spec.block_reason,
        "gateReport": spec.gate_report,
    }
