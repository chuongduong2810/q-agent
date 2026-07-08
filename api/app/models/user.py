"""User model — an authenticated account (ADR 0007).

Local-first installs may have zero users (the global auth guard is off by
default). For shared deployments, users are seeded via ``QAGENT_ADMIN_EMAIL`` /
``QAGENT_ADMIN_PASSWORD`` or created by an admin through ``/auth/users``.

``email`` is always stored lowercased and is unique. ``password_hash`` holds an
argon2 hash (never plaintext). ``role`` is ``"admin"`` or ``"member"``.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column, utcnow

# Role values.
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
USER_ROLES = (ROLE_ADMIN, ROLE_MEMBER)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)  # stored lowercased
    first_name: Mapped[str] = mapped_column(String(120), default="")
    last_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default=ROLE_MEMBER)
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = timestamp_column()
    updated_at: Mapped[datetime] = timestamp_column(onupdate=utcnow)
