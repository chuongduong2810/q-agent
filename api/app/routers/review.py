"""Review Center router — validate AI-generated test cases before automation.

Endpoints implemented:
  GET   /runs/{run_id}/cases                      -> list[TestCaseOut]
  POST  /runs/{run_id}/cases                      -> TestCaseOut        (add manual case; TestCaseCreate)
  PATCH /cases/{case_id}                          -> TestCaseOut        (edit; TestCaseUpdate, sets edited)
  POST  /cases/{case_id}/approval                 -> TestCaseOut        (ApprovalUpdate)
  POST  /cases/{case_id}/regenerate               -> TestCaseOut        (Claude regenerate a single case)
  POST  /runs/{run_id}/approve-all                -> list[TestCaseOut]  (bulk approve non-rejected)
  POST  /runs/{run_id}/tickets/{tid}/approve      -> list[TestCaseOut]  (approve a ticket's cases)

Uses prefix "" (mixes /runs and /cases paths) — declare full paths on each route.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.run import Run
from app.models.testcase import TestCase
from app.schemas import ApprovalUpdate, TestCaseCreate, TestCaseOut, TestCaseUpdate
from app.services.ai_service import next_case_code, regenerate_case
from app.services.claude_cli import ClaudeError

router = APIRouter(tags=["review"])


def _get_run_or_404(db: Session, run_id: int) -> Run:
    run = db.query(Run).filter(Run.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _get_case_or_404(db: Session, case_id: int) -> TestCase:
    case = db.query(TestCase).filter(TestCase.id == case_id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    return case


@router.get("/runs/{run_id}/cases", response_model=list[TestCaseOut])
def list_cases(run_id: int, db: Session = Depends(get_db)) -> list[TestCase]:
    _get_run_or_404(db, run_id)
    return (
        db.query(TestCase)
        .filter(TestCase.run_id == run_id)
        .order_by(TestCase.ticket_external_id, TestCase.code)
        .all()
    )


@router.post("/runs/{run_id}/cases", response_model=TestCaseOut)
def create_case(run_id: int, body: TestCaseCreate, db: Session = Depends(get_db)) -> TestCase:
    _get_run_or_404(db, run_id)

    code = next_case_code(db, run_id, body.ticket_external_id)
    case = TestCase(
        run_id=run_id,
        ticket_external_id=body.ticket_external_id,
        code=code,
        title=body.title,
        precondition=body.precondition,
        steps=[step.model_dump() for step in body.steps],
        priority=body.priority,
        test_type=body.test_type,
        automation=body.automation,
        platform=body.platform,
        source="manual",
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.patch("/cases/{case_id}", response_model=TestCaseOut)
def update_case(case_id: int, body: TestCaseUpdate, db: Session = Depends(get_db)) -> TestCase:
    case = _get_case_or_404(db, case_id)

    updates = body.model_dump(exclude_unset=True)
    if "steps" in updates and updates["steps"] is not None:
        updates["steps"] = [step if isinstance(step, dict) else step for step in updates["steps"]]
    for field, value in updates.items():
        if value is not None:
            setattr(case, field, value)
    case.edited = True

    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.post("/cases/{case_id}/approval", response_model=TestCaseOut)
def set_case_approval(case_id: int, body: ApprovalUpdate, db: Session = Depends(get_db)) -> TestCase:
    case = _get_case_or_404(db, case_id)
    case.approval = body.approval
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.post("/cases/{case_id}/regenerate", response_model=TestCaseOut)
def regenerate_single_case(case_id: int, db: Session = Depends(get_db)) -> TestCase:
    case = _get_case_or_404(db, case_id)
    try:
        return regenerate_case(db, case)
    except ClaudeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/runs/{run_id}/approve-all", response_model=list[TestCaseOut])
def approve_all(run_id: int, db: Session = Depends(get_db)) -> list[TestCase]:
    _get_run_or_404(db, run_id)
    cases = (
        db.query(TestCase)
        .filter(TestCase.run_id == run_id, TestCase.approval != "rejected")
        .all()
    )
    for case in cases:
        case.approval = "approved"
        db.add(case)
    db.commit()
    return (
        db.query(TestCase)
        .filter(TestCase.run_id == run_id)
        .order_by(TestCase.ticket_external_id, TestCase.code)
        .all()
    )


@router.post("/runs/{run_id}/tickets/{tid}/approve", response_model=list[TestCaseOut])
def approve_ticket_cases(run_id: int, tid: str, db: Session = Depends(get_db)) -> list[TestCase]:
    _get_run_or_404(db, run_id)
    cases = (
        db.query(TestCase)
        .filter(
            TestCase.run_id == run_id,
            TestCase.ticket_external_id == tid,
            TestCase.approval != "rejected",
        )
        .all()
    )
    for case in cases:
        case.approval = "approved"
        db.add(case)
    db.commit()
    return (
        db.query(TestCase)
        .filter(TestCase.run_id == run_id, TestCase.ticket_external_id == tid)
        .order_by(TestCase.code)
        .all()
    )
