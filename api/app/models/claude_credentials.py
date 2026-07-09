"""Claude CLI credential model (#95) — per-user or shared ``.credentials.json``.

The Claude CLI reads its OAuth session from ``<CLAUDE_CONFIG_DIR>/.credentials.json``.
Rather than share one machine-wide login, each row here holds the **encrypted**
contents of one user's (or the shared/admin) credentials file so a per-user copy
can be materialized into a private ``CLAUDE_CONFIG_DIR`` before invoking the CLI
(see :mod:`app.services.claude_credentials`).

``owner_id`` NULL identifies the single **shared** credential (used when a user
has not uploaded their own) — there is at most one such row, and at most one row
per non-null ``owner_id``, both enforced by the service layer (not a DB
constraint, matching how singleton rows are handled elsewhere in this codebase,
e.g. :mod:`app.services.settings_store`).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, timestamp_column, utcnow

STATUS_ACTIVE = "active"


class ClaudeCredentials(Base):
    __tablename__ = "claude_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = the shared/admin credential. Reuses the same ownership FK shape as
    # every other per-user table (#91) rather than a bespoke "is_shared" flag.
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    # Fernet-encrypted contents of the `.credentials.json` file (see app.crypto).
    credentials: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(16), default=STATUS_ACTIVE)
    # Best-effort metadata parsed from the uploaded `.credentials.json` (see
    # app.services.claude_credentials._extract_metadata) — all optional, never
    # the token itself.
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, default=None)
    scopes: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)
    subscription_type: Mapped[str | None] = mapped_column(String(40), nullable=True, default=None)
    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
