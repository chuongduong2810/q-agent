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
from app.db import get_db
from app.logging import logger
from app.models.run import Run
from app.models.testcase import AutomationSpec, TestCase
from app.services import spec_service
from app.services.claude_cli import ClaudeError
from app.ws import hub

router = APIRouter(tags=["automation"])


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
    code = spec_service.generate_spec_code(case)
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


def _run_generation(run_id: int) -> None:
    """Background worker: generate specs for every eligible case in a run."""
    db = db_module.SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run is None:
            return
        cases = _eligible_cases_query(db, run_id).all()
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
            except ClaudeError as exc:
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
        run.status = "automation"
        db.commit()
        hub.publish(str(run_id), "run.status", {"status": run.status})
    finally:
        db.close()


@router.post("/runs/{run_id}/automation/generate")
def generate_automation(run_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """Kick off automation spec generation for a run's approved, non-Manual cases.

    Runs generation in a background thread and returns the current specs list
    immediately (per contract). Sets Run.status = 'automation' once the
    background pass completes.
    """
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    thread = threading.Thread(target=_run_generation, args=(run_id,), daemon=True)
    thread.start()

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


@router.get("/cases/{case_id}/spec")
def get_case_spec(case_id: int, db: Session = Depends(get_db)) -> dict:
    """Get the automation spec for a single test case."""
    spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case_id).first()
    if spec is None:
        raise HTTPException(status_code=404, detail="Spec not found")
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


def _spec_out(spec: AutomationSpec) -> dict:
    return {
        "id": spec.id,
        "testCaseId": spec.test_case_id,
        "filename": spec.filename,
        "language": spec.language,
        "framework": spec.framework,
        "code": spec.code,
    }
