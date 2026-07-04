"""AuditLog model — append-only trail of app events for the Audit Log page.

One row per meaningful action (run created, cases generated, run executed,
knowledge built, provider connected, settings changed, …). Rows are written by
``audit_service.record`` and never updated or deleted in normal use.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column

# Category buckets the Audit Log page filters by.
AUDIT_CATEGORIES = (
    "run", "sync", "review", "execution", "knowledge",
    "integration", "settings", "ai", "comment", "automation", "auth",
)
AUDIT_ACTOR_TYPES = ("user", "ai", "system")
AUDIT_STATUSES = ("success", "warning", "error")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = timestamp_column(index=True)
    category: Mapped[str] = mapped_column(String(32), default="run", index=True)
    actor: Mapped[str] = mapped_column(String(120), default="You")
    actor_type: Mapped[str] = mapped_column(String(16), default="user", index=True)
    action: Mapped[str] = mapped_column(String(200), default="")
    target: Mapped[str] = mapped_column(String(400), default="")
    ip: Mapped[str] = mapped_column(String(64), default="internal")
    status: Mapped[str] = mapped_column(String(16), default="success")
    meta: Mapped[str] = mapped_column(Text, default="")
