"""Server-assist for agent-executed self-heal (issue #260).

The self-heal LOOP runs on the Local Agent (where Playwright + the captured DOM
live). The two steps that physically require the server — asking Claude for a
fix (the agent holds no LLM credentials) and reading/writing the DB + Knowledge
Base — are delegated here, called by the ``/agent/heal/*`` endpoints:

* :func:`plan_fix` — given the current spec code + failure + captured DOM, resolve
  project context/examples/KB from the DB, classify the failure, ask Claude for a
  fix, and run the anti-cheat + placeholder gate. Returns the action the agent
  should take (``fixed`` / ``blocked`` / ``rejected`` / ``product_defect``).
* :func:`finalize_agent_heal` — persist the final spec status/code/heal report and
  feed a passing DOM-grounded heal back into the KB.

Both mirror the decisions the in-process server loop
(:func:`app.services.playwright_runner.heal_spec`) makes per attempt, minus the
Playwright execution (which is the agent's job).
"""

from __future__ import annotations

import difflib
import json
from datetime import datetime, timezone
from typing import Any

from app.config import settings
from app.logging import logger
from app.models.run import Run, RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.services import (
    failure_classifier,
    placeholder_gate,
    playwright_runner,
    run_context,
    spec_examples,
    spec_service,
)
from app.services.claude_cli import ClaudeError
from app.services.playwright_runner import _resolve_project_for_run


def _known_with_dom(known: dict, dom_snapshot: dict[str, Any] | None) -> dict:
    """Augment the gate's ``known`` grounding with the live captured DOM (#265).

    A route/selector observed in the actually-rendered page is real, not
    hallucinated — so the placeholder gate must not flag a fix that uses it as an
    "invented reference". This adds the captured pathname (route) and each captured
    element's identifier(s) — as the exact literal forms the gate extracts from code
    (bare test id, ``[data-testid="…"]``, ``#id``) — to ``known``. This is what lets
    a DOM-grounded heal pass the gate (and then enrich the KB on the pass), breaking
    the chicken-and-egg where DOM-derived refs were rejected as unknown.
    """
    if not dom_snapshot:
        return known
    routes = list(known.get("routes") or [])
    selectors = list(known.get("selectors") or [])
    path = (dom_snapshot.get("path") or "").strip()
    if path:
        routes.append({"path": path})
    for el in dom_snapshot.get("elements") or []:
        if not isinstance(el, dict):
            continue
        test_id = el.get("testId")
        if test_id:
            selectors.append({"selector": test_id})
            selectors.append({"selector": f'[data-testid="{test_id}"]'})
        el_id = el.get("id")
        if el_id:
            selectors.append({"selector": f"#{el_id}"})
            selectors.append({"selector": el_id})
    return {**known, "routes": routes, "selectors": selectors}


def _resolve_grounding(db, case: TestCase, run: Run) -> tuple[dict, dict, list[dict]]:
    """Resolve the DB-backed grounding a fix needs: (context, known, examples).

    ``context`` is the full project context (base URL, decrypted creds, routes,
    selectors) from :func:`spec_service.build_case_context`; ``known`` is the
    subset the placeholder gate compares a fix against; ``examples`` are proven
    passing specs for few-shot grounding. Mirrors ``heal_spec``'s setup.
    """
    context = spec_service.build_case_context(db, case, env=run.env)
    known = {
        "routes": context.get("routes", []),
        "selectors": context.get("selectors", []),
        "base_url": context.get("baseUrl", ""),
    }
    project_key, _base_url, _manual_auth, _provider = _resolve_project_for_run(db, run, run.env)
    heal_ticket = (
        db.query(RunTicket)
        .filter(
            RunTicket.run_id == run.id,
            RunTicket.ticket_external_id == case.ticket_external_id,
        )
        .first()
    )
    repo = heal_ticket.repo if heal_ticket else ""
    examples = (
        spec_examples.select_examples(db, project_key, repo, case, limit=2) if project_key else []
    )
    return context, known, examples


def plan_fix(
    db,
    case: TestCase,
    run: Run,
    current_code: str,
    error: str,
    output: str,
    dom_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    """Classify a heal failure and, unless it's a product defect, propose a fix.

    Returns one of::

        {"action": "product_defect", "failureClass": str, "reason": str}
        {"action": "rejected", "reason": str}                       # anti-cheat or gate
        {"action": "blocked", "reason": str, "code": str}           # missing KB grounding
        {"action": "fixed", "code": str, "diff": str}               # apply + re-run

    The agent applies a ``fixed`` result (write the code, re-run) and stops on any
    terminal action, then calls :func:`finalize_agent_heal`.

    Runs under the run's ambient context (:func:`run_context.set_run`) so the Claude
    CLI resolves the **run owner's** credentials — this endpoint is called on a
    request thread with no ambient run, so without this Claude falls back to the
    (logged-out) shared credential and fails with "Not logged in".
    """
    previous_run = run_context.get_run()
    run_context.set_run(run.id)
    try:
        return _plan_fix(db, case, run, current_code, error, output, dom_snapshot)
    finally:
        run_context.set_run(previous_run)


def _plan_fix(
    db,
    case: TestCase,
    run: Run,
    current_code: str,
    error: str,
    output: str,
    dom_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    context, known, examples = _resolve_grounding(db, case, run)

    classification = failure_classifier.classify_failure(case, current_code, error, output, context)
    if classification["suspectedProductDefect"] or classification["failureClass"] == "product_defect":
        return {
            "action": "product_defect",
            "failureClass": classification["failureClass"],
            "reason": classification.get("reason", ""),
        }

    try:
        fixed = spec_service.generate_fixed_spec_code(
            case, current_code, error, output, context, examples, dom_snapshot
        )
    except ClaudeError as exc:
        # Return a clean terminal action (not a 500) so the agent records a failed
        # attempt and stops the loop instead of throwing on the HTTP call.
        return {"action": "rejected", "reason": f"Heal fix generation failed: {exc}"}

    # Anti-cheat: a fix that removes/weakens assertions only "passes" by checking
    # less — reject it and keep the previous spec.
    if placeholder_gate.count_assertions(fixed) < placeholder_gate.count_assertions(current_code):
        return {
            "action": "rejected",
            "reason": "Rejected fix: it removed/weakened assertions (anti-cheat).",
        }

    # Gate against the KB PLUS the live captured DOM — a fix that uses real,
    # observed routes/selectors is grounded, not invented (#265).
    gate = placeholder_gate.gate_spec(fixed, _known_with_dom(known, dom_snapshot))
    if gate["outcome"] == "blocked":
        return {
            "action": "blocked",
            "reason": f'{gate["reason"]} {gate["unblock_action"]}'.strip(),
            "gate": json.dumps(gate),
            "code": fixed,
        }
    if gate["outcome"] == "rejected":
        return {"action": "rejected", "reason": gate["reason"], "gate": json.dumps(gate)}

    diff = "\n".join(
        difflib.unified_diff(
            (current_code or "").splitlines(),
            (fixed or "").splitlines(),
            fromfile="spec (before fix)",
            tofile="spec (after fix)",
            lineterm="",
        )
    )
    return {"action": "fixed", "code": fixed, "diff": diff}


def finalize_agent_heal(db, case: TestCase, run: Run, payload: dict[str, Any]) -> None:
    """Persist an agent heal's outcome and feed a passing DOM-grounded heal into the KB.

    ``payload`` (posted by the agent) carries::

        finalStatus: "pass"|"fail"|"blocked"|"product_defect"
        finalError:  str
        finalCode:   str            # the spec code as it stands after the loop
        blockReason: str            # when finalStatus == "blocked"
        gateReport:  str            # JSON gate dump when blocked
        domDistilled: object|null   # the passing attempt's distilled DOM (KB enrichment)
        lastFixBefore / lastFixAfter: str|null   # most recent accepted fix (selector-swap feedback)
        attempts:    [ {...} ]      # per-attempt trail for the heal report
    """
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
    if spec is None:
        return

    final_status = payload.get("finalStatus", "fail")
    final_code = payload.get("finalCode") or spec.code or ""

    # Persist the spec code the loop ended on + write it to the run's spec dir.
    spec.code = final_code
    spec.path = str(
        spec_service.write_spec_file(
            run.code, case.ticket_external_id, case.code, final_code, run.owner_id
        )
    )

    if final_status == "product_defect":
        spec.status = "product_defect"  # terminal — assertion kept intact
    elif final_status == "blocked":
        spec.status = "blocked"
        spec.block_reason = (payload.get("blockReason") or "").strip()
        if payload.get("gateReport"):
            spec.gate_report = payload["gateReport"]
    else:
        spec.status = "passed" if final_status == "pass" else "failed"

    spec.heal_report = json.dumps(
        {
            "caseId": case.id,
            "finalStatus": final_status,
            "maxAttempts": settings.heal_max_attempts,
            "healedAt": datetime.now(timezone.utc).isoformat(),
            "runsOn": "local-agent",
            "attempts": payload.get("attempts") or [],
        }
    )
    db.commit()

    # KB feedback on a pass (#182 single-selector swap + #249 additive DOM merge).
    if final_status == "pass":
        _project_key, _base_url, _manual, _provider = _resolve_project_for_run(db, run, run.env)
        heal_ticket = (
            db.query(RunTicket)
            .filter(
                RunTicket.run_id == run.id,
                RunTicket.ticket_external_id == case.ticket_external_id,
            )
            .first()
        )
        repo = heal_ticket.repo if heal_ticket else ""
        before, after = payload.get("lastFixBefore"), payload.get("lastFixAfter")
        if before and after:
            playwright_runner._propose_healed_selector_to_kb(
                _project_key, repo, before, after, run.owner_id
            )
        playwright_runner._merge_discovered_dom_to_kb(
            _project_key, repo, final_code, payload.get("domDistilled"), run.owner_id
        )
