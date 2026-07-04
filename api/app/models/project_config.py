"""Project configuration model — user-authored runtime settings for a project.

Complements :class:`app.models.knowledge.ProjectKnowledge` (which is *discovered*
by the ``project-bootstrap`` skill). This model holds what a human configures on
the Project Details page — the values downstream Playwright generation needs to
emit runnable specs without placeholders: the application URL, test accounts,
per-environment URLs, and any other project-specific key/values.

Test-account passwords are stored **encrypted at rest** (see :mod:`app.crypto`),
mirroring how provider credentials are handled, and are never returned to the UI
in plaintext.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column, utcnow


class ProjectConfig(Base):
    __tablename__ = "project_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Keyed by project name (the UI's project identifier), matching ProjectKnowledge.key.
    key: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")

    # Primary application URL the generated automation targets.
    base_url: Mapped[str] = mapped_column(String(500), default="")
    # Repositories that belong to this project (an ADO/GitHub project can hold
    # many). Each entry: {name, repo_url, local_repo_path, role, primary}. The
    # repo flagged ``primary`` is the app the Playwright tests drive and the one
    # project-bootstrap traverses; the rest are recorded as related context.
    repos: Mapped[list] = mapped_column(JSON, default=list)

    # --- Legacy single-repo fields (kept for backward compatibility) ----------
    # Superseded by ``repos``; still honored when ``repos`` is empty.
    local_repo_path: Mapped[str] = mapped_column(String(600), default="")
    repo_url: Mapped[str] = mapped_column(String(600), default="")

    # [{ "name": str, "base_url": str, "notes": str }]
    environments: Mapped[list] = mapped_column(JSON, default=list)
    # [{ "role": str, "username": str, "password": <encrypted>, "notes": str }]
    test_accounts: Mapped[list] = mapped_column(JSON, default=list)
    # Arbitrary project-specific config values downstream generation may reference.
    extra: Mapped[dict] = mapped_column(JSON, default=dict)

    # When True, a run captures a real (headed) browser login before executing
    # specs (if no saved session exists) and reuses the saved storageState.
    manual_auth: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
