"""Shared Execution/ExecutionResult mutation — extracted from
``playwright_runner`` (``_match_result`` + the ``run_execution`` finalize tail,
Local Agent feature, #DRY) so the server runner and the Local Agent's job-push
endpoints (``routers/agent.py``) update rows and emit WS events identically.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.execution import Execution, ExecutionResult
from app.models.run import Run
from app.services import audit_service
from app.services.run_status import set_run_status
from app.ws import hub


def match_result(results: list[ExecutionResult], filename: str) -> ExecutionResult | None:
    """Find the ExecutionResult whose spec filename convention matches ``filename``.

    Filename convention: ``{shortTicket}-{caseCode}.spec.ts`` (see
    ``spec_service.spec_filename``). Shared by the server runner (matching a
    Playwright JSON report entry) and the Local Agent's job-results endpoint
    (matching a pushed result payload).
    """
    name = Path(filename).name
    for result in results:
        expected = f"{result.ticket_external_id.rsplit('-', 1)[-1]}-{result.case_code}.spec.ts"
        if expected == name:
            return result
    return None


def apply_result(
    db: Session, results: list[ExecutionResult], entry: dict[str, Any]
) -> ExecutionResult | None:
    """Match ``entry`` to its ExecutionResult and update status/duration/error.

    Commits the update but does NOT publish ``exec.case.result`` — callers
    decide when/whether to emit it (the server runner publishes only after
    evidence has also been stored, preserving today's event order; the Local
    Agent's events endpoint re-emits explicitly).

    Args:
        db: Active session.
        results: Candidate ExecutionResult rows for the owning Execution.
        entry: A dict shaped like ``parse_playwright_report``'s output — at
            least ``file`` (or ``filename``), ``status``, ``duration_ms``,
            ``error_message``.

    Returns:
        The matched, updated ExecutionResult, or ``None`` if no row's filename
        convention matches ``entry``'s file name.
    """
    filename = entry.get("file") or entry.get("filename") or ""
    result = match_result(results, filename)
    if result is None:
        return None
    result.status = entry.get("status", result.status)
    result.duration_ms = entry.get("duration_ms") or 0
    result.error_message = entry.get("error_message", "")
    db.commit()
    return result


def finalize(db: Session, execution: Execution, run: Run, log: str) -> None:
    """Finalize an Execution: stamp the log, mark done, advance the run, notify.

    Expects ``execution.passed``/``execution.failed``/``execution.total`` to
    already reflect the final counts (the caller sets these first). Commits,
    publishes ``exec.progress`` (100%) + ``exec.done``, advances ``run.status``
    to ``"evidence"``, and records the execution audit entry. Shared by the
    server runner's normal completion path and the Local Agent's
    ``POST /agent/jobs/{id}/complete`` endpoint.
    """
    execution.log = (log or "")[-20000:]
    execution.progress = 100
    execution.status = "done"
    execution.finished_at = datetime.now(timezone.utc)
    db.commit()

    run_id_str = str(run.id)
    hub.publish(
        run_id_str,
        "exec.progress",
        {"progress": 100, "passed": execution.passed, "failed": execution.failed, "remaining": 0},
    )
    hub.publish(run_id_str, "exec.done", {"passed": execution.passed, "failed": execution.failed})
    set_run_status(db, run, "evidence")

    audit_service.record(
        category="execution", actor_type="ai", action="Executed test run",
        target=f"{run.code} · {execution.total} cases",
        status="warning" if execution.failed else "success",
        meta=f"{execution.passed} passed · {execution.failed} failed",
    )
