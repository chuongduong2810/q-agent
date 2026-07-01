"""Report model — aggregated outcome of a run's execution."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    execution_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    overall_result: Mapped[str] = mapped_column(String(16), default="unknown")  # passed/failed
    pass_rate: Mapped[float] = mapped_column(default=0.0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    env: Mapped[str] = mapped_column(String(32), default="Staging")

    # {ticketSummary: [...], aiFailureAnalysis: str, flaky: [...], trend: [...]}
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = timestamp_column()
