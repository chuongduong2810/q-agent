"""Single transition point for ``Run.status`` — the terminal-guard invariant.

See ADR 0005. Every stage transition in the pipeline (AI generation, sync,
automation, execution, comment) goes through :func:`set_run_status` instead of
assigning ``run.status`` directly, so a worker thread that finishes a stage
*after* the run was cancelled/failed can never resurrect it into an
in-progress status.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import utcnow
from app.models.run import RUN_STATUSES, TERMINAL_RUN_STATUSES, Run
from app.services import audit_service
from app.ws import hub

# Active-work statuses with no live worker to recover after a restart —
# every non-terminal status except "review", which is a legitimate
# human-gated pause and must be left alone (see recover_orphaned_runs).
_ORPHANABLE_RUN_STATUSES = tuple(
    s for s in RUN_STATUSES if s not in TERMINAL_RUN_STATUSES and s != "review"
)


def set_run_status(db: Session, run: Run, new: str) -> bool:
    """Transition ``run.status`` to ``new``, enforcing the terminal guard.

    Args:
        db: Active session; the transition is committed here.
        run: The Run row to transition.
        new: The status to move to (one of ``RUN_STATUSES``).

    Returns:
        True if the transition was applied. False (no-op) if the run is
        already in a terminal status (``done``/``cancelled``/``failed``) —
        callers running in worker threads MUST check this and stop rather
        than continue the stage, so a cancel/failure can never be overwritten
        by a stage that was already in flight.
    """
    if run.status in TERMINAL_RUN_STATUSES:
        return False
    run.status = new
    if new in TERMINAL_RUN_STATUSES:
        run.finished_at = utcnow()
    db.add(run)
    db.commit()
    audit_service.record(
        category="run", actor_type="system", action="Run status changed",
        target=f"{run.code} · {new}",
    )
    hub.publish(str(run.id), "run.status", {"status": new})
    return True


def recover_orphaned_runs(db: Session) -> int:
    """Sweep runs left in a non-terminal "active work" status with no worker.

    Called once at API startup (ADR 0005 / ARCHITECTURE-REVIEW §4.1), after the
    process's own worker threads are known to be dead — a bare `threading.Thread`
    never survives a process restart, so any run still sitting in an in-progress
    stage (``processing``, ``sync``, ``automation``, ``executing``, ``evidence``,
    ``comment``) was abandoned mid-work by a crashed/killed/redeployed process.
    ``review`` is excluded: it is a legitimate human-gated pause, not a stuck
    worker, so it is left untouched.

    Each orphaned run is marked ``failed`` with ``failed_stage`` set to its
    abandoned status, via :func:`set_run_status` (so the normal audit row +
    ``run.status`` WS event fire exactly as any other failure would). This makes
    the run terminal and retryable through the existing ADR-0005
    ``_RETRY_RESUME_STAGE`` dispatch table.

    Args:
        db: Active session.

    Returns:
        The number of runs recovered.
    """
    orphaned = db.query(Run).filter(Run.status.in_(_ORPHANABLE_RUN_STATUSES)).all()
    for run in orphaned:
        run.failed_stage = run.status
        set_run_status(db, run, "failed")
    return len(orphaned)


def force_status(db: Session, run: Run, new: str) -> None:
    """Directly set ``run.status``, bypassing the terminal guard.

    Used exclusively by the retry endpoint to intentionally move a terminal
    run back into the pipeline. Unlike :func:`set_run_status` this never
    stamps ``finished_at`` (the run is active again) but still broadcasts the
    same ``run.status`` WS event so the UI reflects the change immediately.
    """
    run.status = new
    db.add(run)
    db.commit()
    hub.publish(str(run.id), "run.status", {"status": new})
