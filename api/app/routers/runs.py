"""Runs + AI analysis + test-case generation router.

Endpoints implemented:
  GET  /runs                      -> list[RunOut]
  POST /runs                      -> RunDetailOut     (body: RunCreate; kicks off async AI pipeline)
  GET  /runs/{run_id}             -> RunDetailOut
  GET  /runs/{run_id}/tickets     -> list[RunTicketOut]  (per-ticket analysis + gen status)
  POST /runs/{run_id}/regenerate  -> RunDetailOut     (re-run analysis/generation)

On create: for each ticket -> Claude analyze (business rules, risks, edge cases…)
-> Claude generate ADO-style test cases -> persist TestCase rows -> advance
Run.status processing→review. Publish WS progress events per ticket/phase.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.schemas import (
    RunCreate,
    RunDetailOut,
    RunOut,
    RunRepoOptionOut,
    RunTicketOut,
    RunTicketRepoUpdate,
)
from app.services import audit_service, project_config_service
from app.services.ai_service import run_generation_pipeline

router = APIRouter(prefix="/runs", tags=["runs"])

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
    return project_config_service.resolve_project_key(db, ticket.provider_kind)


@router.get("", response_model=list[RunOut])
def list_runs(db: Session = Depends(get_db)) -> list[Run]:
    return db.query(Run).order_by(Run.created_at.desc()).all()


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
    return _get_run_or_404(db, run_id)


@router.get("/{run_id}/tickets", response_model=list[RunTicketOut])
def list_run_tickets(run_id: int, db: Session = Depends(get_db)) -> list[RunTicket]:
    _get_run_or_404(db, run_id)
    return (
        db.query(RunTicket)
        .filter(RunTicket.run_id == run_id)
        .order_by(RunTicket.position)
        .all()
    )


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

    run.status = "processing"
    db.add(run)
    db.commit()
    db.refresh(run)

    audit_service.record(
        category="run", actor_type="user", action="Regenerated run",
        target=f"{run.code} · {run.name}",
    )

    run_generation_pipeline(run.id, blocking=False)

    # If the pipeline ran synchronously (blocking, e.g. in tests) it committed via
    # its own session — refresh so this response reflects the final state.
    db.refresh(run)

    return run
