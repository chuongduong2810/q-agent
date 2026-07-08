"""Provider connection model — a named account for a provider kind.

Supersedes the singleton :class:`app.models.provider.Provider` for credential
routing (see ADR 0006). A provider *kind* (ado/jira/github) may now hold **many**
named ``ProviderConnection`` rows, and each kind belongs to one of two
**categories**:

- **work_item** (``ado``, ``jira``) — the source of tickets / work items.
- **repository** (``github``) — the source of code repositories.

``config`` holds non-secret connection fields (org URL, project, org, repo,
baseUrl…); secret fields (PAT / API token) are stored encrypted in ``secrets``
(see :mod:`app.crypto`) and are never serialized back to clients in plaintext.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, timestamp_column, utcnow
from app.models.provider import ADO, GITHUB, JIRA

# Provider categories.
WORK_ITEM = "work_item"
REPOSITORY = "repository"

# Code-level classification of each kind (no per-kind DB row).
PROVIDER_CATEGORY: dict[str, str] = {
    ADO: WORK_ITEM,
    JIRA: WORK_ITEM,
    GITHUB: REPOSITORY,
}

# Human-readable default names per kind (used when creating a connection).
PROVIDER_DISPLAY_NAMES: dict[str, str] = {
    ADO: "Azure DevOps",
    JIRA: "Jira",
    GITHUB: "GitHub",
}


def category_for(kind: str) -> str:
    """Return the category ('work_item' | 'repository') for a provider kind."""
    return PROVIDER_CATEGORY.get(kind, WORK_ITEM)


class ProviderConnection(Base):
    """A named connection to an external provider account."""

    __tablename__ = "provider_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # ado/jira/github — NOT unique
    name: Mapped[str] = mapped_column(String(120), default="")
    connected: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    secrets: Mapped[dict] = mapped_column(JSON, default=dict)  # encrypted values
    last_sync: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)

    @property
    def category(self) -> str:
        return category_for(self.kind)
