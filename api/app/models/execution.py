"""Execution, per-case result, and evidence models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTime, timestamp_column

EXEC_STATUSES = ("queued", "running", "passed", "failed", "done")
# Where an Execution's Playwright run happens (Local Agent feature): "server"
# (legacy — spawned in a background thread on this process) or "local-agent"
# (queued for a paired device to claim via /agent/jobs/next).
EXEC_TARGETS = ("server", "local-agent")
CASE_RESULT_STATUSES = ("pending", "running", "pass", "fail", "skipped")
EVIDENCE_KINDS = ("screenshot", "video", "trace", "console", "network", "summary")
# Root-cause classification of a failed result (see failure_classifier). "" = unclassified.
FAILURE_CLASSES = ("", "test_defect", "product_defect", "flaky", "environment", "timeout")


class Execution(Base):
    __tablename__ = "executions"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    # See EXEC_TARGETS. "local-agent" executions are created status="queued" and
    # never spawn the in-process runner thread — a paired device claims them.
    target: Mapped[str] = mapped_column(String(16), default="server")
    claimed_by_device_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_devices.id"), nullable=True
    )
    env: Mapped[str] = mapped_column(String(32), default="Staging")
    browser: Mapped[str] = mapped_column(String(32), default="chromium")
    workers: Mapped[int] = mapped_column(Integer, default=4)

    total: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0..100

    log: Mapped[str] = mapped_column(Text, default="")  # combined Playwright stdout/stderr

    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = timestamp_column()

    results: Mapped[list["ExecutionResult"]] = relationship(
        back_populates="execution", cascade="all, delete-orphan"
    )


class ExecutionResult(Base):
    __tablename__ = "execution_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("executions.id", ondelete="CASCADE"), index=True
    )
    test_case_id: Mapped[int] = mapped_column(Integer, index=True)
    ticket_external_id: Mapped[str] = mapped_column(String(64), index=True)
    case_code: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(500), default="")

    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # Root-cause classification of a failure (see FAILURE_CLASSES); "" until classified.
    failure_class: Mapped[str] = mapped_column(String(24), default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str] = mapped_column(Text, default="")
    console_logs: Mapped[list] = mapped_column(JSON, default=list)
    network_logs: Mapped[list] = mapped_column(JSON, default=list)

    execution: Mapped["Execution"] = relationship(back_populates="results")
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="result", cascade="all, delete-orphan"
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    result_id: Mapped[int] = mapped_column(
        ForeignKey("execution_results.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), index=True)  # screenshot/video/trace/...
    path: Mapped[str] = mapped_column(String(600), default="")  # relative to workspace/evidence
    filename: Mapped[str] = mapped_column(String(200), default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    annotated: Mapped[bool] = mapped_column(default=False)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = timestamp_column()

    result: Mapped["ExecutionResult"] = relationship(back_populates="evidence")
