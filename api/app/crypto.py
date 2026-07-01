"""Symmetric encryption for provider credentials (PATs / API tokens).

Credentials must never be stored or returned in plaintext. We derive a stable
Fernet key from the configured ``secret_key`` and use it to encrypt secret
fields at rest.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

_PREFIX = "enc::"


def _fernet() -> Fernet:
    # Derive a deterministic 32-byte key from the secret and base64-encode it.
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str | None) -> str | None:
    """Encrypt a plaintext secret. Returns a prefixed token, or None/empty as-is."""
    if not value:
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return _PREFIX + token


def decrypt(value: str | None) -> str | None:
    """Decrypt a value produced by :func:`encrypt`. Passthrough if not encrypted."""
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_PREFIX)


def mask(value: str | None) -> str:
    """Render a secret for display without leaking it."""
    if not value:
        return ""
    return "••••••••"
