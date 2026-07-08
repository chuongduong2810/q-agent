"""Project model — a connected project from a provider."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_kind: Mapped[str] = mapped_column(String(16), index=True)
    external_id: Mapped[str] = mapped_column(String(128), index=True)  # ADO/Jira project id/key
    name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(default=False)
    # The work-item connection that discovered this project (set during refresh);
    # convenience only — not the credential router (ADR 0006).
    connection_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("provider_connections.id"), nullable=True
    )
    meta: Mapped[dict] = mapped_column(JSON, default=dict)  # tickets/runs/rate cached stats
    created_at: Mapped[datetime] = timestamp_column()
