"""Linked test case model — an approved test case created in the provider and
linked back to its work item (shown on the Ticket detail page)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column, utcnow


class LinkedTestCase(Base):
    __tablename__ = "linked_test_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), nullable=True)
    test_case_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # source TestCase
    ticket_external_id: Mapped[str] = mapped_column(String(64), index=True)
    provider_kind: Mapped[str] = mapped_column(String(16))

    external_id: Mapped[str] = mapped_column(String(64))  # provider work-item/issue id
    title: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(32), default="Design")
    url: Mapped[str] = mapped_column(String(600), default="")
    linked: Mapped[bool] = mapped_column(Boolean, default=False)  # linked to the work item

    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
