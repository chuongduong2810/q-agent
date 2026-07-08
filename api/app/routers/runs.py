"""Runs + AI analysis + test-case generation router.

Endpoints implemented:
  GET    /runs                      -> list[RunOut]
  POST   /runs                      -> RunDetailOut     (body: RunCreate; kicks off async AI pipeline)
  GET    /runs/{run_id}             -> RunDetailOut
  GET    /runs/{run_id}/tickets     -> list[RunTicketOut]  (per-ticket analysis + gen status)
  POST   /runs/{run_id}/regenerate  -> RunDetailOut     (re-run analysis/generation)
  POST   /runs/{run_id}/cancel      -> RunOut            (ADR 0005 — cancel an in-progress run)
  POST   /runs/{run_id}/retry       -> RunOut            (ADR 0005 — resume a terminal run)
  DELETE /runs/{run_id}             -> 204                (ADR 0005 — hard delete + cascade)

On create: for each ticket -> Claude analyze (business rules, risks, edge cases…)
-> Claude generate ADO-style test cases -> persist TestCase rows -> advance
Run.status processing→review. Publish WS progress events per ticket/phase.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db, utcnow
from app.models.claude_usage import ClaudeUsage
from app.models.comment import TicketComment
from app.models.execution import Execution
from app.models.linked import LinkedTestCase
from app.models.report import Report
from app.models.run import TERMINAL_RUN_STATUSES, Run, RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.routers import automation as automation_router
from app.routers import comments as comments_router
from app.routers import execution as execution_router
from app.schemas import (
    RunCreate,
    RunDetailOut,
    RunOut,
    RunRepoOptionOut,
    RunTicketOut,
    RunTicketRepoUpdate,
)
from app.services import ai_usage_service, audit_service, link_service, project_config_service, run_control
from app.services.ai_service import run_generation_pipeline
from app.services.run_status import force_status, set_run_status

router = APIRouter(prefix="/runs", tags=["runs"])

# ADR 0005 retry dispatch table: failed_stage (resume from) -> resume stage.
# "review" has nothing of its own to resume (it's a user-gated stop) so it
# re-runs AI generation; unknown/null falls back to "processing" too.
_RETRY_RESUME_STAGE = {
    "processing": "processing",
    "review": "processing",
    "sync": "sync",
    "automation": "automation",
    "executing": "executing",
    "evidence": "executing",
    "comment": "comment",
}

SCOPE_LABELS = {
    "single": "Single ticket",
    "selected": "Selected tickets",
    "assigned": "Assigned to me",
    "sprint": "Current sprint",
}


def _next_run_code(db: Session) -> str:
    """Compute the next RUN-{n} code: max existing numeric suffix + 1, starting at 200."""
    max_n = 199
    for (code,) in db.query(Run.code).all():
        match = re.match(r"RUN-(\d+)$", code or "")
        if match:
            max_n = max(max_n, int(match.group(1)))
    return f"RUN-{max_n + 1}"


def _get_run_or_404(db: Session, run_id: int) -> Run:
    run = db.query(Run).filter(Run.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _resolve_run_project_key(db: Session, run: Run) -> str | None:
    """Resolve the project key a run's tickets belong to (via its first ticket)."""
    first = (
        db.query(RunTicket)
        .filter(RunTicket.run_id == run.id)
        .order_by(RunTicket.position)
        .first()
    )
    if first is None:
        return None
    ticket = (
        db.query(Ticket).filter(Ticket.external_id == first.ticket_external_id).first()
    )
    if ticket is None:
        return None
    return project_config_service.project_key_for_ticket(db, ticket)


def _attach_run_aggregates(db: Session, runs: list[Run]) -> list[Run]:
    """Attach list-display aggregates to each run as transient attributes:
    ``case_count`` (# test cases), ``total``/``passed`` (from the run's latest
    execution — the "passed / N" progress), and ``pass_rate`` (0..100 from the
    run's latest report, else None). Batched — three grouped queries total, no
    per-run N+1.
    """
    if not runs:
        return runs
    run_ids = [r.id for r in runs]

    case_counts = dict(
        db.query(TestCase.run_id, func.count(TestCase.id))
        .filter(TestCase.run_id.in_(run_ids))
        .group_by(TestCase.run_id)
        .all()
    )

    # Latest execution / report per run via max(id) over the run's rows.
    latest_exec_ids = [
        eid
        for (eid,) in db.query(func.max(Execution.id))
        .filter(Execution.run_id.in_(run_ids))
        .group_by(Execution.run_id)
        .all()
    ]
    execs = {
        e.run_id: e for e in db.query(Execution).filter(Execution.id.in_(latest_exec_ids)).all()
    }
    latest_report_ids = [
        rid
        for (rid,) in db.query(func.max(Report.id))
        .filter(Report.run_id.in_(run_ids))
        .group_by(Report.run_id)
        .all()
    ]
    reports = {
        r.run_id: r for r in db.query(Report).filter(Report.id.in_(latest_report_ids)).all()
    }

    for run in runs:
        run.case_count = case_counts.get(run.id, 0)
        execution = execs.get(run.id)
        run.total = execution.total if execution else 0
        run.passed = execution.passed if execution else 0
        report = reports.get(run.id)
        run.pass_rate = report.pass_rate if report else None
    return runs


@router.get("", response_model=list[RunOut])
def list_runs(db: Session = Depends(get_db)) -> list[Run]:
    runs = db.query(Run).order_by(Run.created_at.desc()).all()
    return _attach_run_aggregates(db, runs)


@router.post("", response_model=RunDetailOut)
def create_run(body: RunCreate, db: Session = Depends(get_db)) -> Run:
    ticket_ids = list(body.ticket_ids or [])
    # For a sprint-scoped run without explicit ids, resolve the sprint's tickets
    # from the synced DB (matched on the sprint leaf name).
    if not ticket_ids and body.scope == "sprint" and body.sprint:
        ticket_ids = [
            t.external_id
            for t in db.query(Ticket).filter(Ticket.sprint == body.sprint).all()
        ]
        if not ticket_ids:
            raise HTTPException(
                status_code=400,
                detail=f"No synced tickets found for sprint '{body.sprint}'. Sync the sprint first.",
            )
    if not ticket_ids:
        raise HTTPException(status_code=400, detail="ticket_ids must not be empty")

    run = Run(
        code=_next_run_code(db),
        name=f"Run over {len(ticket_ids)} ticket(s)",
        scope=body.scope,
        scope_label=SCOPE_LABELS.get(body.scope, body.scope),
        framework=body.framework,
        browser=body.browser,
        env=body.env,
        workers=body.workers,
        retry_policy=body.retry_policy,
        status="processing",
    )
    db.add(run)
    db.flush()

    for position, ticket_external_id in enumerate(ticket_ids):
        db.add(
            RunTicket(
                run_id=run.id,
                ticket_external_id=ticket_external_id,
                position=position,
                gen_status="queued",
            )
        )
    db.commit()
    db.refresh(run)

    audit_service.record(
        category="run", actor_type="user", action="Created run",
        target=f"{run.code} · {run.name}",
        meta=f"{run.framework} · {run.env} · {run.workers} workers",
    )

    run_generation_pipeline(run.id, blocking=False)

    # If the pipeline ran synchronously (blocking, e.g. in tests) it committed via
    # its own session — refresh so this response reflects the final state.
    db.refresh(run)

    return run


@router.get("/{run_id}", response_model=RunDetailOut)
def get_run(run_id: int, db: Session = Depends(get_db)) -> Run:
    run = _get_run_or_404(db, run_id)
    _attach_run_aggregates(db, [run])
    return run


@router.get("/{run_id}/tickets", response_model=list[RunTicketOut])
def list_run_tickets(run_id: int, db: Session = Depends(get_db)) -> list[RunTicket]:
    _get_run_or_404(db, run_id)
    return (
        db.query(RunTicket)
        .filter(RunTicket.run_id == run_id)
        .order_by(RunTicket.position)
        .all()
    )


@router.get("/{run_id}/ai-usage")
def get_run_ai_usage(run_id: int, db: Session = Depends(get_db)) -> dict:
    """Per-run Claude cost/token attribution, grouped by process (see contract)."""
    _get_run_or_404(db, run_id)
    return ai_usage_service.run_breakdown(db, run_id)


@router.get("/{run_id}/repos", response_model=list[RunRepoOptionOut])
def list_run_repos(run_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """The run's project repositories, each with its per-repo knowledge status.

    Resolves the project from the run's first work item's ticket provider; returns
    an empty list when no project can be resolved.
    """
    run = _get_run_or_404(db, run_id)
    key = _resolve_run_project_key(db, run)
    if not key:
        return []
    return project_config_service.repo_options(db, key)


@router.post("/{run_id}/tickets/{tid}/repo", response_model=RunTicketOut)
def set_run_ticket_repo(
    run_id: int, tid: str, body: RunTicketRepoUpdate, db: Session = Depends(get_db)
) -> RunTicket:
    """Set a work item's target repository.

    An empty ``repo`` resets it to the project default. A non-empty value must be
    one of the project's configured repo names, else HTTP 400.
    """
    run = _get_run_or_404(db, run_id)
    run_ticket = (
        db.query(RunTicket)
        .filter(RunTicket.run_id == run.id, RunTicket.ticket_external_id == tid)
        .first()
    )
    if run_ticket is None:
        raise HTTPException(status_code=404, detail="Run ticket not found")

    repo = (body.repo or "").strip()
    if repo:
        key = _resolve_run_project_key(db, run)
        configured = {opt["name"] for opt in project_config_service.repo_options(db, key)} if key else set()
        if repo not in configured:
            raise HTTPException(
                status_code=400, detail=f"Repo '{repo}' is not configured for this project"
            )

    run_ticket.repo = repo
    db.add(run_ticket)
    db.commit()
    db.refresh(run_ticket)
    return run_ticket


@router.post("/{run_id}/regenerate", response_model=RunDetailOut)
def regenerate_run(run_id: int, db: Session = Depends(get_db)) -> Run:
    run = _get_run_or_404(db, run_id)

    # Clear prior AI output so the pipeline starts fresh.
    db.query(TestCase).filter(TestCase.run_id == run.id).delete()
    for run_ticket in db.query(RunTicket).filter(RunTicket.run_id == run.id).all():
        run_ticket.gen_status = "queued"
        run_ticket.analysis = {}
        run_ticket.analysis_error = ""
        db.add(run_ticket)

    db.commit()
    set_run_status(db, run, "processing")

    audit_service.record(
        category="run", actor_type="user", action="Regenerated run",
        target=f"{run.code} · {run.name}",
    )

    run_generation_pipeline(run.id, blocking=False)

    # If the pipeline ran synchronously (blocking, e.g. in tests) it committed via
    # its own session — refresh so this response reflects the final state.
    db.refresh(run)

    return run


@router.post("/{run_id}/cancel", response_model=RunOut)
def cancel_run(run_id: int, db: Session = Depends(get_db)) -> Run:
    """Cancel an in-progress run (ADR 0005). 409 if it's already terminal.

    Persists ``cancel_requested``/``cancelled_at``, signals the in-memory
    cancel event, kills any tracked live subprocess (mid-case Playwright kill),
    then transitions the run to ``cancelled`` — authoritative because every
    worker checkpoint checks the terminal guard before advancing.
    """
    run = _get_run_or_404(db, run_id)
    if run.status in TERMINAL_RUN_STATUSES:
        raise HTTPException(status_code=409, detail="Run is already terminal")

    run.cancel_requested = True
    run.cancelled_at = utcnow()
    db.add(run)
    db.commit()

    run_control.request_cancel(run.id)
    run_control.kill_processes(run.id)
    set_run_status(db, run, "cancelled")

    audit_service.record(
        category="run", actor_type="user", action="Cancelled run", target=run.code,
    )
    db.refresh(run)
    return run


@router.post("/{run_id}/retry", response_model=RunOut)
def retry_run(run_id: int, db: Session = Depends(get_db)) -> Run:
    """Resume a terminal run from ``failed_stage`` (ADR 0005 dispatch table).

    409 unless the run is terminal (``done``/``cancelled``/``failed``). Resets
    the cancel bookkeeping, clears the in-process cancel/process registry, then
    directly moves the run out of its terminal status (bypassing the guard —
    this is the one intentional exception to it) and re-dispatches the resume
    stage's existing worker entry point.
    """
    run = _get_run_or_404(db, run_id)
    if run.status not in TERMINAL_RUN_STATUSES:
        raise HTTPException(status_code=409, detail="Run is not terminal — cancel it first")

    resume_stage = _RETRY_RESUME_STAGE.get(run.failed_stage or "", "processing")

    run_control.clear(run.id)
    run.cancel_requested = False
    run.cancelled_at = None
    run.finished_at = None
    run.failed_stage = None
    db.add(run)
    db.commit()

    force_status(db, run, resume_stage)

    audit_service.record(
        category="run", actor_type="user", action="Retried run",
        target=f"{run.code} · resumed at {resume_stage}",
    )

    if resume_stage == "processing":
        # Clear prior AI output so the pipeline starts fresh (mirrors regenerate_run).
        db.query(TestCase).filter(TestCase.run_id == run.id).delete()
        for run_ticket in db.query(RunTicket).filter(RunTicket.run_id == run.id).all():
            run_ticket.gen_status = "queued"
            run_ticket.analysis = {}
            run_ticket.analysis_error = ""
            db.add(run_ticket)
        db.commit()
        run_generation_pipeline(run.id, blocking=False)
    elif resume_stage == "sync":
        link_service.start_create_link(run.id, link=True, ticket_ids=None)
    elif resume_stage == "automation":
        automation_router.generate_automation(run.id, force=False, db=db)
    elif resume_stage == "executing":
        execution_router.start_execution(run.id, body={}, db=db)
    elif resume_stage == "comment":
        comments_router.retry_comments(run.id, db)

    db.refresh(run)
    return run


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: int, db: Session = Depends(get_db)) -> None:
    """Hard-delete a run and all related rows in one transaction (ADR 0005).

    409 if the run is still in progress — cancel it first. SQLite does not
    enforce ``ondelete`` without ``PRAGMA foreign_keys=ON``, so related rows are
    removed explicitly: executions and test cases are deleted via the ORM (so
    their own children — execution results/evidence, automation specs —
    cascade too); reports/comments/claude usage are bulk-deleted by run_id;
    linked test cases are kept but detached (``run_id`` set to ``NULL``).
    """
    run = _get_run_or_404(db, run_id)
    if run.status not in TERMINAL_RUN_STATUSES:
        raise HTTPException(status_code=409, detail="Run is in progress — cancel it first")

    code = run.code

    for execution in db.query(Execution).filter(Execution.run_id == run_id).all():
        db.delete(execution)  # cascades to ExecutionResult -> Evidence
    for case in db.query(TestCase).filter(TestCase.run_id == run_id).all():
        db.delete(case)  # cascades to AutomationSpec

    db.query(Report).filter(Report.run_id == run_id).delete(synchronize_session=False)
    db.query(TicketComment).filter(TicketComment.run_id == run_id).delete(synchronize_session=False)
    db.query(ClaudeUsage).filter(ClaudeUsage.run_id == run_id).delete(synchronize_session=False)
    db.query(LinkedTestCase).filter(LinkedTestCase.run_id == run_id).update(
        {LinkedTestCase.run_id: None}, synchronize_session=False
    )

    db.delete(run)  # cascades to RunTicket via the ORM delete-orphan relationship
    db.commit()

    run_control.clear(run_id)
    audit_service.record(category="run", actor_type="user", action="Deleted run", target=code)
