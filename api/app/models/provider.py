"""Provider connection model (Azure DevOps / Jira / GitHub)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, timestamp_column, utcnow

# Provider kinds
ADO = "ado"
JIRA = "jira"
GITHUB = "github"
PROVIDER_KINDS = (ADO, JIRA, GITHUB)


class Provider(Base):
    """A configured external system.

    ``config`` holds non-secret connection fields (org URL, project, email…).
    Secret fields (PAT / API token) are stored encrypted in ``secrets`` and are
    never serialized back to clients in plaintext.
    """

    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), unique=True, index=True)  # one row per kind (MVP)
    name: Mapped[str] = mapped_column(String(64))
    connected: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    secrets: Mapped[dict] = mapped_column(JSON, default=dict)  # encrypted values
    last_sync: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
