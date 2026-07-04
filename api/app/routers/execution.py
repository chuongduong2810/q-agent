"""Execution router — run the approved Playwright suite for a Run.

Endpoints to implement:
  POST /runs/{run_id}/execution        -> ExecutionOut   (start; body ExecutionStart; async)
  GET  /runs/{run_id}/execution        -> ExecutionOut   (latest execution + results)
  GET  /executions/{execution_id}      -> ExecutionOut

Spawns Playwright (real) against workspace/specs, streams per-case status via WS
(events: exec.case.running / exec.case.result / exec.progress / exec.done),
records ExecutionResult + Evidence rows, advances Run.status executing→evidence.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.execution import Evidence, Execution, ExecutionResult
from app.models.run import Run
from app.models.testcase import TestCase
from app.services.playwright_runner import run_execution
from app.ws import hub

router = APIRouter(tags=["execution"])


@router.post("/runs/{run_id}/execution")
def start_execution(
    run_id: int,
    body: dict = Body(default_factory=dict),
    db: Session = Depends(get_db),
) -> dict:
    """Create an Execution + pending ExecutionResults, then run Playwright in a thread."""
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    cases = (
        db.query(TestCase)
        .filter(
            TestCase.run_id == run_id,
            TestCase.approval == "approved",
            TestCase.automation != "Manual",
        )
        .order_by(TestCase.id)
        .all()
    )
    if not cases:
        raise HTTPException(status_code=400, detail="No approved, automatable test cases to execute")

    workers = body.get("workers") or run.workers
    env = body.get("env") or run.env

    execution = Execution(
        run_id=run_id,
        status="running",
        env=env,
        browser=run.browser,
        workers=workers,
        total=len(cases),
        started_at=datetime.now(timezone.utc),
    )
    db.add(execution)
    db.flush()

    for case in cases:
        db.add(
            ExecutionResult(
                execution_id=execution.id,
                test_case_id=case.id,
                ticket_external_id=case.ticket_external_id,
                case_code=case.code,
                title=case.title,
                status="pending",
            )
        )

    run.status = "executing"
    db.commit()
    db.refresh(execution)

    hub.publish(str(run_id), "run.status", {"status": run.status})

    thread = threading.Thread(target=run_execution, args=(execution.id,), daemon=True)
    thread.start()

    return _execution_out(db, execution)


@router.post("/cases/{case_id}/spec/run")
def run_single_spec(case_id: int, db: Session = Depends(get_db)) -> dict:
    """Execute just one test case's spec (the "run this test" action).

    Creates an Execution with a single pending ExecutionResult and runs only that
    spec (run_execution runs one file when the execution has one result). 404 if
    the case/spec/run is missing; 400 if the case isn't automatable.
    """
    case = db.get(TestCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    if case.approval != "approved" or case.automation == "Manual":
        raise HTTPException(status_code=400, detail="Case is not an approved, automatable test")
    run = db.get(Run, case.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    execution = Execution(
        run_id=run.id,
        status="running",
        env=run.env,
        browser=run.browser,
        workers=1,
        total=1,
        started_at=datetime.now(timezone.utc),
    )
    db.add(execution)
    db.flush()
    db.add(
        ExecutionResult(
            execution_id=execution.id,
            test_case_id=case.id,
            ticket_external_id=case.ticket_external_id,
            case_code=case.code,
            title=case.title,
            status="pending",
        )
    )
    run.status = "executing"
    db.commit()
    db.refresh(execution)

    hub.publish(str(run.id), "run.status", {"status": run.status})
    threading.Thread(target=run_execution, args=(execution.id,), daemon=True).start()
    return _execution_out(db, execution)


@router.get("/runs/{run_id}/execution")
def get_latest_execution(run_id: int, db: Session = Depends(get_db)) -> dict:
    """Return the most recent Execution for a run, with its results."""
    execution = (
        db.query(Execution)
        .filter(Execution.run_id == run_id)
        .order_by(Execution.id.desc())
        .first()
    )
    if execution is None:
        raise HTTPException(status_code=404, detail="No execution found for this run")
    return _execution_out(db, execution)


@router.get("/executions/{execution_id}")
def get_execution(execution_id: int, db: Session = Depends(get_db)) -> dict:
    """Return a single Execution by id, with its results."""
    execution = db.get(Execution, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    return _execution_out(db, execution)


def _execution_out(db: Session, execution: Execution) -> dict:
    results = (
        db.query(ExecutionResult)
        .filter(ExecutionResult.execution_id == execution.id)
        .order_by(ExecutionResult.id)
        .all()
    )
    return {
        "id": execution.id,
        "runId": execution.run_id,
        "status": execution.status,
        "env": execution.env,
        "browser": execution.browser,
        "workers": execution.workers,
        "total": execution.total,
        "passed": execution.passed,
        "failed": execution.failed,
        "progress": execution.progress,
        "log": execution.log,
        "startedAt": execution.started_at,
        "finishedAt": execution.finished_at,
        "results": [_result_out(db, r) for r in results],
    }


def _result_out(db: Session, result: ExecutionResult) -> dict:
    evidence = (
        db.query(Evidence).filter(Evidence.result_id == result.id).order_by(Evidence.id).all()
    )
    return {
        "id": result.id,
        "testCaseId": result.test_case_id,
        "ticketExternalId": result.ticket_external_id,
        "caseCode": result.case_code,
        "title": result.title,
        "status": result.status,
        "durationMs": result.duration_ms,
        "errorMessage": result.error_message,
        "consoleLogs": result.console_logs,
        "networkLogs": result.network_logs,
        "evidence": [
            {
                "id": e.id,
                "kind": e.kind,
                "filename": e.filename,
                "path": e.path,
                "sizeBytes": e.size_bytes,
                "annotated": e.annotated,
                "meta": e.meta,
            }
            for e in evidence
        ],
    }
