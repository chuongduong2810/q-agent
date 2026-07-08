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
from app.models.run import TERMINAL_RUN_STATUSES, Run
from app.services import audit_service
from app.ws import hub


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
