"""Auth service — password hashing, JWTs, refresh sessions, TOTP, CSRF (ADR 0007).

Pure logic + DB helpers used by ``routers/auth.py`` and the global guard. All
tokens are signed with ``settings.secret_key`` (HS256), the same secret that
derives the credential-encryption key.

Token kinds (all HS256 with distinct ``typ`` claims so they can't be confused):
  - **access**  : short-lived (~15 min), claims ``{sub, role, sid, typ:"access"}``.
  - **mfa**     : very short-lived (~5 min), binds a user mid-login (``typ:"mfa"``).
  - **reset**   : short-lived (~30 min) password-reset token (``typ:"reset"``).

Refresh tokens are opaque (``secrets.token_urlsafe``); only their sha256 hash is
persisted on a :class:`Session` row. The plaintext lives only in the HttpOnly
``qagent_refresh`` cookie.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.db import utcnow
from app.models.session import Session as AuthSession
from app.models.user import User

# ---------------------------------------------------------------- constants
ACCESS_TTL = timedelta(minutes=15)
MFA_TTL = timedelta(minutes=5)
RESET_TTL = timedelta(minutes=30)
REFRESH_TTL_REMEMBER = timedelta(days=30)
REFRESH_TTL_DEFAULT = timedelta(hours=12)

_ALGO = "HS256"
_ph = PasswordHasher()


class AuthError(Exception):
    """Raised on invalid/expired tokens or failed verification."""


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):  # noqa: BLE001
        return False


# ---------------------------------------------------------------- JWTs
def _encode(claims: dict[str, Any], ttl: timedelta, typ: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {**claims, "typ": typ, "iat": int(now.timestamp()), "exp": int((now + ttl).timestamp())}
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGO)


def _decode(token: str, typ: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGO])
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("Invalid token") from exc
    if payload.get("typ") != typ:
        raise AuthError("Wrong token type")
    return payload


def create_access_token(user: User, sid: str) -> str:
    # email + name are carried so the audit layer can attribute events without a
    # DB lookup (see services.audit_context).
    name = f"{user.first_name} {user.last_name}".strip()
    return _encode(
        {"sub": str(user.id), "role": user.role, "sid": sid, "email": user.email, "name": name},
        ACCESS_TTL,
        "access",
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode an access token. Raises AuthError on expiry/invalid/wrong-type."""
    return _decode(token, "access")


def access_token_valid(token: str | None) -> bool:
    """True if ``token`` is a well-formed, unexpired access token (guard/WS use)."""
    if not token:
        return False
    try:
        decode_access_token(token)
        return True
    except AuthError:
        return False


def create_mfa_token(user: User) -> str:
    return _encode({"sub": str(user.id)}, MFA_TTL, "mfa")


def decode_mfa_token(token: str) -> dict[str, Any]:
    return _decode(token, "mfa")


def create_reset_token(user: User) -> str:
    return _encode({"sub": str(user.id)}, RESET_TTL, "reset")


def decode_reset_token(token: str) -> dict[str, Any]:
    return _decode(token, "reset")


# ---------------------------------------------------------------- refresh sessions
def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _refresh_ttl(remember: bool) -> timedelta:
    return REFRESH_TTL_REMEMBER if remember else REFRESH_TTL_DEFAULT


def create_session(
    db: DbSession, user: User, *, remember: bool = False, user_agent: str = "", ip: str = ""
) -> tuple[AuthSession, str]:
    """Create a refresh session row. Returns (session, plaintext_refresh_token)."""
    sid = uuid.uuid4().hex
    token = secrets.token_urlsafe(48)
    now = utcnow()
    session = AuthSession(
        id=sid,
        user_id=user.id,
        refresh_token_hash=_hash_refresh(token),
        user_agent=(user_agent or "")[:400],
        ip=(ip or "")[:64],
        created_at=now,
        last_seen_at=now,
        expires_at=now + _refresh_ttl(remember),
        revoked_at=None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, token


def get_valid_session(db: DbSession, sid: str) -> AuthSession | None:
    """Return the session if it exists, is not revoked, and not expired."""
    session = db.get(AuthSession, sid)
    if session is None or session.revoked_at is not None:
        return None
    exp = session.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is not None and exp <= utcnow():
        return None
    return session


def verify_refresh(session: AuthSession, token: str) -> bool:
    return hmac.compare_digest(session.refresh_token_hash, _hash_refresh(token))


def rotate(db: DbSession, session: AuthSession, *, remember: bool | None = None) -> str:
    """Issue a new opaque refresh token, update the row in place. Returns plaintext."""
    token = secrets.token_urlsafe(48)
    now = utcnow()
    session.refresh_token_hash = _hash_refresh(token)
    session.last_seen_at = now
    if remember is not None:
        session.expires_at = now + _refresh_ttl(remember)
    db.add(session)
    db.commit()
    db.refresh(session)
    return token


def revoke(db: DbSession, sid: str) -> None:
    session = db.get(AuthSession, sid)
    if session is not None and session.revoked_at is None:
        session.revoked_at = utcnow()
        db.add(session)
        db.commit()


def revoke_others(db: DbSession, user_id: int, keep_sid: str) -> int:
    """Revoke all of the user's active sessions except ``keep_sid``. Returns count."""
    rows = (
        db.query(AuthSession)
        .filter(
            AuthSession.user_id == user_id,
            AuthSession.id != keep_sid,
            AuthSession.revoked_at.is_(None),
        )
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
        db.add(row)
    db.commit()
    return len(rows)


def list_sessions(db: DbSession, user_id: int) -> list[AuthSession]:
    """Active (non-revoked, non-expired) sessions for a user, newest first."""
    rows = (
        db.query(AuthSession)
        .filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_seen_at.desc())
        .all()
    )
    now = utcnow()

    def _live(row: AuthSession) -> bool:
        exp = row.expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return exp is None or exp > now

    return [r for r in rows if _live(r)]


# ---------------------------------------------------------------- TOTP
def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Q-Agent")


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    try:
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- CSRF
def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def verify_csrf(cookie_value: str | None, header_value: str | None) -> bool:
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value, header_value)


# ---------------------------------------------------------------- users
def get_user_by_email(db: DbSession, email: str) -> User | None:
    return db.query(User).filter(User.email == (email or "").strip().lower()).first()


def authenticate(db: DbSession, email: str, password: str) -> User | None:
    """Return the active user if credentials are valid, else None."""
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    if not verify_password(user.password_hash, password):
        return None
    return user
