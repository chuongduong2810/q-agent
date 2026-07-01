"""Test case + generated automation spec models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, timestamp_column

APPROVAL_STATUSES = ("pending", "approved", "rejected")
AUTOMATION_TYPES = ("Playwright", "Selenium", "Cypress", "Manual")
SOURCES = ("ai", "manual")


class TestCase(Base):
    __tablename__ = "test_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    ticket_external_id: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(String(32))  # e.g. "TC-01"

    title: Mapped[str] = mapped_column(String(500))
    precondition: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)  # [{a, e}]

    priority: Mapped[str] = mapped_column(String(16), default="Medium")
    test_type: Mapped[str] = mapped_column(String(48), default="Functional")
    automation: Mapped[str] = mapped_column(String(32), default="Playwright")
    platform: Mapped[str] = mapped_column(String(16), default="Web")
    duration: Mapped[str] = mapped_column(String(16), default="—")

    approval: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    source: Mapped[str] = mapped_column(String(16), default="ai")
    edited: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = timestamp_column()

    spec: Mapped["AutomationSpec | None"] = relationship(
        back_populates="test_case", cascade="all, delete-orphan", uselist=False
    )


class AutomationSpec(Base):
    __tablename__ = "automation_specs"

    id: Mapped[int] = mapped_column(primary_key=True)
    test_case_id: Mapped[int] = mapped_column(
        ForeignKey("test_cases.id", ondelete="CASCADE"), index=True, unique=True
    )
    filename: Mapped[str] = mapped_column(String(200))  # e.g. "1428-TC-01.spec.ts"
    language: Mapped[str] = mapped_column(String(32), default="TypeScript")
    framework: Mapped[str] = mapped_column(String(32), default="Playwright")
    code: Mapped[str] = mapped_column(Text, default="")
    path: Mapped[str] = mapped_column(String(500), default="")  # on-disk spec path
    created_at: Mapped[datetime] = timestamp_column()

    test_case: Mapped["TestCase"] = relationship(back_populates="spec")
