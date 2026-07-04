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

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import db as db_module
from app.config import settings
from app.db import get_db
from app.logging import logger
from app.models.run import Run
from app.models.testcase import AutomationSpec, TestCase
from app.schemas import AutomationSpecUpdate
from app.services import audit_service, playwright_runner, spec_service
from app.services.claude_cli import ClaudeError
from app.ws import hub

router = APIRouter(tags=["automation"])

# Run ids with an in-flight generation pass — lets the UI reflect the running
# state after navigating away/back, and prevents double-triggering generation.
_generating: set[int] = set()


def is_generating(run_id: int) -> bool:
    return run_id in _generating


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


def _generate_one(db: Session, run: Run, case: TestCase) -> AutomationSpec:
    """Generate (or regenerate) and persist the AutomationSpec for one case.

    Args:
        db: Active session (caller commits).
        run: The owning Run (provides run.code for the spec path).
        case: The approved, non-Manual TestCase to generate a spec for.

    Returns:
        The created or updated AutomationSpec row (not yet committed).
    """
    context = spec_service.build_case_context(db, case, env=run.env)
    code = spec_service.generate_spec_code(case, context)
    path = spec_service.write_spec_file(run.code, case.ticket_external_id, case.code, code)
    filename = spec_service.spec_filename(case.ticket_external_id, case.code)

    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
    if spec is None:
        spec = AutomationSpec(test_case_id=case.id)
        db.add(spec)
    spec.filename = filename
    spec.language = "TypeScript"
    spec.framework = "Playwright"
    spec.code = code
    spec.path = str(path)
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
    db = db_module.SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run is None:
            return
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
        for index, case in enumerate(cases, start=1):
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
    finally:
        # Always flip the run to 'automation' and announce it, even if the run
        # vanished or the loop raised — so the UI's generating state resolves.
        run = db.get(Run, run_id)
        if run is not None:
            run.status = "automation"
            db.commit()
            hub.publish(str(run_id), "run.status", {"status": run.status})
        _generating.discard(run_id)
        db.close()


@router.post("/runs/{run_id}/automation/generate")
def generate_automation(
    run_id: int, force: bool = False, db: Session = Depends(get_db)
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
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

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
def list_automation(run_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """List all generated automation specs for a run."""
    specs = (
        db.query(AutomationSpec)
        .join(TestCase, AutomationSpec.test_case_id == TestCase.id)
        .filter(TestCase.run_id == run_id)
        .all()
    )
    return [_spec_out(s) for s in specs]


@router.get("/runs/{run_id}/automation/status")
def automation_status(run_id: int) -> dict:
    """Whether a generation pass is currently running for this run.

    Lets the UI restore the 'generating' state after navigating away/back and
    keep the Generate button disabled instead of re-triggering.
    """
    return {"generating": is_generating(run_id)}


@router.get("/cases/{case_id}/spec")
def get_case_spec(case_id: int, db: Session = Depends(get_db)) -> dict:
    """Get the automation spec for a single test case."""
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Spec not found")
    return _spec_out(spec)


@router.patch("/cases/{case_id}/spec")
def update_case_spec(
    case_id: int, payload: AutomationSpecUpdate, db: Session = Depends(get_db)
) -> dict:
    """Persist manual edits to a case's spec and rewrite the on-disk .spec.ts file.

    Updates AutomationSpec.code, rewrites the file so execution picks up the
    edits, and refreshes AutomationSpec.path. 404 if the case has no spec.
    """
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Spec not found")

    case = db.get(TestCase, spec.test_case_id)
    run = db.get(Run, case.run_id)

    spec.code = payload.code
    path = spec_service.write_spec_file(
        run.code, case.ticket_external_id, case.code, payload.code
    )
    spec.path = str(path)
    db.commit()
    db.refresh(spec)
    return _spec_out(spec)


@router.post("/cases/{case_id}/spec/regenerate")
def regenerate_case_spec(case_id: int, db: Session = Depends(get_db)) -> dict:
    """Synchronously regenerate the automation spec for a single test case."""
    case = db.get(TestCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    run = db.get(Run, case.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        spec = _generate_one(db, run, case)
    except ClaudeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    db.commit()
    db.refresh(spec)
    hub.publish(
        str(run.id),
        "automation.progress",
        {"file": spec.filename, "message": "Regenerated", "done": 1, "total": 1},
    )
    return _spec_out(spec)


@router.post("/cases/{case_id}/spec/heal")
def heal_case_spec(case_id: int, db: Session = Depends(get_db)) -> dict:
    """Start a self-heal loop for one case: run its spec and, while it fails,
    feed the failure back to Claude to regenerate + re-run, up to a cap.

    Runs in a background thread (streams ``heal.progress`` WS events) and returns
    immediately. 409 if the run is executing or another case in the run is
    already healing (they share the run's spec dir).
    """
    case = db.get(TestCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    run = db.get(Run, case.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
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
def heal_case_spec_status(case_id: int) -> dict:
    """Whether a self-heal pass is running for this case (survives navigation)."""
    return playwright_runner.heal_state(case_id)


@router.get("/cases/{case_id}/spec/heal/report")
def heal_case_spec_report(case_id: int, db: Session = Depends(get_db)) -> dict:
    """The last self-heal trail for a case: per-attempt error, diff and outcome.

    Returns ``{}`` if the case has no spec or has never been healed.
    """
    import json as _json

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
    }
