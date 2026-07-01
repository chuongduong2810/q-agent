"""Reports router.

Endpoints:
  POST /runs/{run_id}/report      -> ReportOut         (build/refresh from latest execution + Claude failure analysis)
  GET  /runs/{run_id}/report      -> ReportOut
  GET  /reports                   -> list[ReportOut]   (recent, for the Reports screen)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.report import Report
from app.schemas import ReportOut
from app.services.report_service import build_report

router = APIRouter(tags=["reports"])


@router.post("/runs/{run_id}/report", response_model=ReportOut)
def create_report(run_id: int, db: Session = Depends(get_db)) -> Report:
    return build_report(db, run_id)


@router.get("/runs/{run_id}/report", response_model=ReportOut)
def get_run_report(run_id: int, db: Session = Depends(get_db)) -> Report:
    stmt = (
        select(Report).where(Report.run_id == run_id).order_by(Report.id.desc()).limit(1)
    )
    report = db.execute(stmt).scalars().first()
    if report is None:
        raise HTTPException(status_code=404, detail="No report for this run")
    return report


@router.get("/reports", response_model=list[ReportOut])
def list_reports(db: Session = Depends(get_db)) -> list[Report]:
    stmt = select(Report).order_by(Report.id.desc()).limit(50)
    return list(db.execute(stmt).scalars())
