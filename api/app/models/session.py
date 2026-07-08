"""Session model — a refresh-token session (ADR 0007).

One row per active login (device/browser). The row id is the opaque session id
(``sid``) embedded in the access token so an access token can be tied back to a
still-valid refresh session. Only the **hash** of the refresh token is stored;
the plaintext token lives solely in the ``qagent_refresh`` HttpOnly cookie.

A session is valid when ``revoked_at`` is NULL and ``expires_at`` is in the
future. ``rotate`` issues a new refresh token and stamps a fresh hash on refresh.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, timestamp_column, utcnow


class Session(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # uuid4().hex == sid
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), default="")  # sha256 hex
    user_agent: Mapped[str] = mapped_column(String(400), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = timestamp_column()
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
