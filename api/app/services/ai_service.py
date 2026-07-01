"""AI analysis + test-case generation pipeline.

Runs (per Run) over each of its RunTicket rows: analyzes the ticket with Claude,
then generates ADO-style manual test cases with Claude, persisting TestCase rows.
Publishes WS progress events throughout. Per ADR 0001 there is no simulated
fallback — Claude errors are surfaced on the RunTicket (`gen_status='error'`,
`analysis_error=...`) and published as a WS event.

Runs in a background thread (kicked off by the runs router), so it opens its
OWN DB session via ``SessionLocal`` rather than reusing a request-scoped session.
"""

from __future__ import annotations

import threading

from sqlalchemy.orm import Session

from app import db as db_module
from app.logging import logger
from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.services.claude_cli import ClaudeError, run_json
from app.services.skills import REQUIREMENT_ANALYST, TEST_CASE_GENERATOR
from app.services.prompts import (
    build_analysis_prompt,
    build_case_regenerate_prompt,
    build_generation_prompt,
)
from app.ws import hub

PHASE_READING = "reading"
PHASE_UNDERSTANDING_AC = "understanding acceptance criteria"
PHASE_BUSINESS_RULES = "identifying business rules"
PHASE_GENERATING = "generating test cases"


def _publish_phase(run_id: int, ticket_external_id: str, phase: str, message: str) -> None:
    hub.publish(
        str(run_id),
        "analysis.phase",
        {"ticket": ticket_external_id, "phase": phase, "message": message},
    )


def next_case_code(db: Session, run_id: int, ticket_external_id: str) -> str:
    """Compute the next TC-NN code for a ticket within a run."""
    existing = (
        db.query(TestCase)
        .filter(TestCase.run_id == run_id, TestCase.ticket_external_id == ticket_external_id)
        .all()
    )
    max_n = 0
    for case in existing:
        suffix = case.code.rsplit("-", 1)[-1]
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f"TC-{max_n + 1:02d}"


def _process_run_ticket(db: Session, run: Run, run_ticket: RunTicket) -> None:
    """Analyze + generate test cases for a single RunTicket. Commits as it goes."""
    ticket = db.query(Ticket).filter(Ticket.external_id == run_ticket.ticket_external_id).first()
    if ticket is None:
        run_ticket.gen_status = "error"
        run_ticket.analysis_error = f"Ticket {run_ticket.ticket_external_id} not found"
        db.add(run_ticket)
        db.commit()
        hub.publish(
            str(run.id),
            "analysis.phase",
            {
                "ticket": run_ticket.ticket_external_id,
                "phase": "error",
                "message": run_ticket.analysis_error,
            },
        )
        return

    try:
        run_ticket.gen_status = "analyzing"
        db.add(run_ticket)
        db.commit()

        _publish_phase(run.id, ticket.external_id, PHASE_READING, "Reading ticket details...")
        _publish_phase(
            run.id, ticket.external_id, PHASE_UNDERSTANDING_AC, "Understanding acceptance criteria..."
        )
        _publish_phase(
            run.id, ticket.external_id, PHASE_BUSINESS_RULES, "Identifying business rules..."
        )

        analysis = run_json(
            build_analysis_prompt(ticket),
            skill=REQUIREMENT_ANALYST,
            label=f"Analyze {ticket.external_id}",
        )
        if not isinstance(analysis, dict):
            raise ClaudeError("Claude analysis response was not a JSON object")

        run_ticket.analysis = analysis
        run_ticket.gen_status = "generating"
        db.add(run_ticket)
        db.commit()

        _publish_phase(run.id, ticket.external_id, PHASE_GENERATING, "Generating test cases...")

        cases = run_json(
            build_generation_prompt(ticket, analysis),
            skill=TEST_CASE_GENERATOR,
            label=f"Generate cases: {ticket.external_id}",
        )
        if not isinstance(cases, list):
            raise ClaudeError("Claude generation response was not a JSON array")

        case_count = 0
        for i, raw_case in enumerate(cases, start=1):
            if not isinstance(raw_case, dict):
                continue
            steps = raw_case.get("steps") or []
            steps = [
                {"a": s.get("a", ""), "e": s.get("e", "")} for s in steps if isinstance(s, dict)
            ]
            test_case = TestCase(
                run_id=run.id,
                ticket_external_id=ticket.external_id,
                code=f"TC-{i:02d}",
                title=raw_case.get("title", ""),
                precondition=raw_case.get("precondition", ""),
                steps=steps,
                priority=raw_case.get("priority", "Medium"),
                test_type=raw_case.get("testType", "Functional"),
                automation=raw_case.get("automation", "Playwright"),
                platform=raw_case.get("platform", "Web"),
                source="ai",
            )
            db.add(test_case)
            case_count += 1
        db.commit()

        run_ticket.gen_status = "done"
        db.add(run_ticket)
        db.commit()

        hub.publish(
            str(run.id),
            "analysis.ticketDone",
            {"ticket": ticket.external_id, "caseCount": case_count},
        )
    except ClaudeError as exc:
        logger.error("AI pipeline error for run={} ticket={}: {}", run.id, ticket.external_id, exc)
        run_ticket.gen_status = "error"
        run_ticket.analysis_error = str(exc)
        db.add(run_ticket)
        db.commit()
        hub.publish(
            str(run.id),
            "analysis.phase",
            {"ticket": ticket.external_id, "phase": "error", "message": str(exc)},
        )


def _run_pipeline(run_id: int) -> None:
    """The actual pipeline body; opens its own session. Safe to call from any thread."""
    db = db_module.SessionLocal()
    try:
        run = db.query(Run).filter(Run.id == run_id).first()
        if run is None:
            logger.warning("run_generation_pipeline: run {} not found", run_id)
            return

        run_tickets = (
            db.query(RunTicket)
            .filter(RunTicket.run_id == run.id)
            .order_by(RunTicket.position)
            .all()
        )
        for run_ticket in run_tickets:
            _process_run_ticket(db, run, run_ticket)

        run.status = "review"
        db.add(run)
        db.commit()
        hub.publish(str(run.id), "run.status", {"status": run.status})
    finally:
        db.close()


def run_generation_pipeline(run_id: int, *, blocking: bool = False) -> threading.Thread | None:
    """Kick off the analyze+generate pipeline for a run.

    If ``blocking`` is True (used by tests), runs synchronously in the calling
    thread and returns None. Otherwise starts a background daemon thread and
    returns it immediately so the caller (the request handler) can respond
    without waiting.
    """
    if blocking:
        _run_pipeline(run_id)
        return None
    thread = threading.Thread(target=_run_pipeline, args=(run_id,), daemon=True)
    thread.start()
    return thread


def regenerate_case(db: Session, test_case: TestCase) -> TestCase:
    """Ask Claude to regenerate a single test case in place, keeping its code.

    Uses the parent RunTicket's stored analysis (if any) for context. Raises
    ClaudeError if the CLI call fails; caller is responsible for surfacing it.
    """
    ticket = (
        db.query(Ticket).filter(Ticket.external_id == test_case.ticket_external_id).first()
    )
    if ticket is None:
        raise ClaudeError(f"Ticket {test_case.ticket_external_id} not found")

    run_ticket = (
        db.query(RunTicket)
        .filter(
            RunTicket.run_id == test_case.run_id,
            RunTicket.ticket_external_id == test_case.ticket_external_id,
        )
        .first()
    )
    analysis = run_ticket.analysis if run_ticket else {}

    existing_case = {
        "title": test_case.title,
        "precondition": test_case.precondition,
        "steps": test_case.steps,
        "priority": test_case.priority,
        "testType": test_case.test_type,
        "automation": test_case.automation,
        "platform": test_case.platform,
    }

    result = run_json(
        build_case_regenerate_prompt(ticket, analysis, existing_case), skill=TEST_CASE_GENERATOR
    )
    if not isinstance(result, dict):
        raise ClaudeError("Claude case-regenerate response was not a JSON object")

    steps = result.get("steps") or []
    steps = [{"a": s.get("a", ""), "e": s.get("e", "")} for s in steps if isinstance(s, dict)]

    test_case.title = result.get("title", test_case.title)
    test_case.precondition = result.get("precondition", test_case.precondition)
    test_case.steps = steps or test_case.steps
    test_case.priority = result.get("priority", test_case.priority)
    test_case.test_type = result.get("testType", test_case.test_type)
    test_case.automation = result.get("automation", test_case.automation)
    test_case.platform = result.get("platform", test_case.platform)
    test_case.edited = True

    db.add(test_case)
    db.commit()
    db.refresh(test_case)
    return test_case
