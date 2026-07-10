"""Local Agent device pairing + authentication (Local Agent feature).

A device (the Node "Local Agent" CLI running on a user's own machine)
authenticates with a long-lived opaque bearer token, mirroring the
refresh-session pattern in :mod:`app.services.auth_service`
(``create_session`` — see ``auth_service.py:129-158``): only the sha256 hash of
the device token is ever persisted; the plaintext is returned exactly once, at
pairing redemption.

Pairing flow:

1. The SPA (an already-authenticated user) requests a short-lived pairing code
   (:func:`create_pairing_code`) — a signed JWT (``typ="pair"``, ~5 min TTL)
   carrying the user's id. This reuses ``auth_service``'s ``_encode``/``_decode``
   JWT plumbing directly rather than a separate one-time-code table.
2. The user copies the code into the Local Agent CLI, which redeems it
   (:func:`redeem_pairing_code`) to create an :class:`AgentDevice` row and
   receive the one-time plaintext device token.
3. The agent authenticates subsequent requests with ``Authorization: Bearer
   <device-token>``, resolved via :func:`authenticate_token`
   (``app.deps_auth.require_agent``).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.db import utcnow
from app.models.agent_device import AgentDevice
from app.models.user import User
from app.services.auth_service import _decode, _encode

# Short-lived — long enough to copy/paste the code into the CLI, short enough
# that a leaked code can't be redeemed later.
PAIR_TTL = timedelta(minutes=5)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_pairing_code(db: DbSession, user: User) -> str:
    """Issue a short-lived pairing code (signed JWT, ``typ="pair"``) for ``user``.

    The code is opaque to the agent — it just relays it back at redemption.
    ``db`` is accepted for symmetry with the rest of this module's signatures
    (unused here; no DB row is created until redemption).

    Returns:
        The signed pairing-code JWT, valid for :data:`PAIR_TTL`.
    """
    return _encode({"sub": str(user.id)}, PAIR_TTL, "pair")


def redeem_pairing_code(db: DbSession, code: str, name: str = "") -> tuple[AgentDevice, str]:
    """Validate a pairing code and create a new paired device.

    Args:
        db: Active session.
        code: The pairing code minted by :func:`create_pairing_code`.
        name: Optional human-friendly device name (e.g. hostname), shown in the
            paired-devices list. Defaults to "Local Agent" when blank.

    Returns:
        ``(device, plaintext_token)`` — the plaintext is returned ONLY here; the
        stored row holds just its sha256 hash.

    Raises:
        auth_service.AuthError: if the code is invalid/expired/wrong-type.
    """
    payload: dict[str, Any] = _decode(code, "pair")
    owner_id = int(payload.get("sub", 0) or 0)
    token = secrets.token_urlsafe(48)
    device = AgentDevice(
        owner_id=owner_id,
        name=(name or "").strip()[:200] or "Local Agent",
        token_hash=_hash_token(token),
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device, token


def authenticate_token(db: DbSession, raw: str) -> AgentDevice | None:
    """Resolve a device from its raw bearer token. None if missing/invalid/revoked."""
    if not raw:
        return None
    return (
        db.query(AgentDevice)
        .filter(AgentDevice.token_hash == _hash_token(raw), AgentDevice.revoked_at.is_(None))
        .first()
    )


def touch_last_seen(db: DbSession, device: AgentDevice) -> None:
    """Stamp ``device.last_seen_at`` = now and persist."""
    device.last_seen_at = utcnow()
    db.add(device)
    db.commit()


def list_devices(db: DbSession, user: User) -> list[AgentDevice]:
    """Non-revoked devices paired to ``user``, newest first."""
    return (
        db.query(AgentDevice)
        .filter(AgentDevice.owner_id == user.id, AgentDevice.revoked_at.is_(None))
        .order_by(AgentDevice.created_at.desc())
        .all()
    )


def revoke(db: DbSession, user: User, device_id: int) -> AgentDevice | None:
    """Revoke a device owned by ``user``.

    Returns:
        The revoked device, or ``None`` if no such device exists / it isn't
        owned by ``user`` (idempotent if it was already revoked).
    """
    device = db.get(AgentDevice, device_id)
    if device is None or device.owner_id != user.id:
        return None
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        db.add(device)
        db.commit()
    return device
