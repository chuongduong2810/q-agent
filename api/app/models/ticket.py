"""Ticket model — a read-only work item imported from a provider."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column

# Work-item statuses used by the UI status pills.
STATUSES = ("Ready for QA", "In Progress", "Blocked", "Done")
PRIORITIES = ("High", "Medium", "Low")


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), index=True)  # e.g. "SUR-1428"
    provider_kind: Mapped[str] = mapped_column(String(16), index=True)
    project_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    # The work-item connection this ticket was synced from (ADR 0006). Nullable —
    # legacy rows and un-stamped tickets fall back to first-of-kind resolution.
    connection_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("provider_connections.id"), index=True, nullable=True
    )

    title: Mapped[str] = mapped_column(String(500))
    work_item_type: Mapped[str] = mapped_column(String(32), default="User Story")
    status: Mapped[str] = mapped_column(String(32), default="Ready for QA")
    priority: Mapped[str] = mapped_column(String(16), default="Medium")
    assignee: Mapped[str] = mapped_column(String(120), default="")
    sprint: Mapped[str] = mapped_column(String(120), default="")
    area_path: Mapped[str] = mapped_column(String(300), default="")
    epic: Mapped[str] = mapped_column(String(300), default="")

    description: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")

    labels: Mapped[list] = mapped_column(JSON, default=list)
    acceptance_criteria: Mapped[list] = mapped_column(JSON, default=list)  # list[str]
    comments: Mapped[list] = mapped_column(JSON, default=list)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    linked_prs: Mapped[list] = mapped_column(JSON, default=list)

    synced_at: Mapped[datetime] = timestamp_column()

    @property
    def ac_count(self) -> int:
        return len(self.acceptance_criteria or [])
