"""Per-call Claude CLI usage records (tokens, cost, latency).

Every successful Claude CLI invocation appends one row here so the usage-stats
panel (``GET /ai/stats``) can aggregate real per-call token, cost and latency
figures over time windows. Written best-effort by
:mod:`app.services.ai_usage_service` — a logging failure must never break a call.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, utcnow


class ClaudeUsage(Base):
    __tablename__ = "claude_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(64), default="")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    action: Mapped[str] = mapped_column(String(120), default="")  # skill / label
