"""Project Knowledge Base model — what Q-Agent learned about a project's repo.

Produced by the `project-bootstrap` skill (via Claude CLI) and reused by every
downstream AI action (analysis, generation, automation).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, timestamp_column, utcnow

KNOWLEDGE_STATUSES = ("not_indexed", "indexed", "stale")


class ProjectKnowledge(Base):
    __tablename__ = "project_knowledge"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Keyed by project name (the UI's project identifier). One row per project.
    key: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(64), default="")
    repo: Mapped[str] = mapped_column(String(300), default="")
    framework: Mapped[str] = mapped_column(String(64), default="Playwright")

    status: Mapped[str] = mapped_column(String(16), default="not_indexed", index=True)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[str] = mapped_column(String(16), default="v1")
    needs_refresh: Mapped[bool] = mapped_column(Boolean, default=False)
    last_indexed: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # {branch, stack[], architecture, domain, locator, assets, pageObjects,
    #  fixtures, utilities[]}
    knowledge: Mapped[dict] = mapped_column(JSON, default=dict)
    # Directory holding the emitted knowledge.md + knowledge.json (skill artifacts).
    doc_path: Mapped[str] = mapped_column(String(600), default="")

    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
