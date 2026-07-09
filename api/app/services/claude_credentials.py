"""Claude CLI credentials — per-user or shared ``.credentials.json`` (#95).

The Claude CLI reads its OAuth session from ``<CLAUDE_CONFIG_DIR>/.credentials.json``
(default ``~/.claude/.credentials.json``). Instead of one shared machine login,
each user may upload their own credentials file; an admin may also configure one
shared/fallback credential (``owner_id`` NULL) for users who haven't.

Resolution order (:func:`resolve_effective`): the requesting user's own
credential, else the shared credential, else ``None`` (no interactive
``claude login`` fallback — see ADR 0001, no simulated/implicit auth).

On resolve, the stored (Fernet-encrypted) contents are decrypted and written to
a private per-key directory under ``workspace/claude-config/<key>/.credentials.json``
(``<key>`` is the user id for an own credential, or ``"shared"``) so
``app.services.claude_cli`` can point the subprocess at it via
``CLAUDE_CONFIG_DIR`` — see :func:`materialize`.
"""

from __future__ import annotations

import json
import stat
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app import crypto
from app.config import settings
from app.models.claude_credentials import STATUS_ACTIVE, ClaudeCredentials

__all__ = [
    "ClaudeCredentialsError",
    "delete_own",
    "delete_shared",
    "get_own",
    "get_shared",
    "materialize",
    "resolve_ambient_owner_id",
    "resolve_effective_config_dir",
    "status_for",
    "upsert_own",
    "upsert_shared",
]


class ClaudeCredentialsError(ValueError):
    """Raised when uploaded credentials contents are not valid JSON."""


def _validate(raw_credentials: str) -> str:
    """Return ``raw_credentials`` unchanged if it parses as a JSON object.

    Raises :class:`ClaudeCredentialsError` (a 400 to the caller) on malformed
    input — we never persist something the CLI couldn't read back.
    """
    try:
        parsed = json.loads(raw_credentials)
    except json.JSONDecodeError as exc:
        raise ClaudeCredentialsError(f"credentials must be valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ClaudeCredentialsError("credentials must be a JSON object")
    return raw_credentials


def _extract_metadata(raw_credentials: str) -> dict:
    """Best-effort extraction of subscription metadata from an uploaded
    ``.credentials.json``.

    Reads from the ``claudeAiOauth`` object when present, else falls back to
    top-level keys. Every field is optional — malformed/missing data yields
    ``None`` rather than raising; the caller has already validated
    ``raw_credentials`` parses as a JSON object.

    Returns a dict with ``expires_at`` (``datetime | None``, converted from an
    ``expiresAt`` epoch-ms value), ``scopes`` (``list[str] | None``), and
    ``subscription_type`` (``str | None``).
    """
    empty = {"expires_at": None, "scopes": None, "subscription_type": None}
    try:
        parsed = json.loads(raw_credentials)
    except json.JSONDecodeError:
        return empty
    if not isinstance(parsed, dict):
        return empty

    oauth = parsed.get("claudeAiOauth")
    source = oauth if isinstance(oauth, dict) else parsed

    expires_at = None
    raw_expires_ms = source.get("expiresAt")
    if isinstance(raw_expires_ms, (int, float)) and not isinstance(raw_expires_ms, bool):
        try:
            expires_at = datetime.fromtimestamp(raw_expires_ms / 1000, tz=timezone.utc)
        except (ValueError, OverflowError, OSError):
            expires_at = None

    scopes = None
    raw_scopes = source.get("scopes")
    if isinstance(raw_scopes, list) and all(isinstance(s, str) for s in raw_scopes):
        scopes = raw_scopes

    subscription_type = None
    raw_subscription_type = source.get("subscriptionType")
    if isinstance(raw_subscription_type, str):
        subscription_type = raw_subscription_type

    return {
        "expires_at": expires_at,
        "scopes": scopes,
        "subscription_type": subscription_type,
    }


def get_own(db: Session, owner_id: int) -> ClaudeCredentials | None:
    """Return the given user's own credential row, or None."""
    return (
        db.query(ClaudeCredentials)
        .filter(ClaudeCredentials.owner_id == owner_id)
        .first()
    )


def get_shared(db: Session) -> ClaudeCredentials | None:
    """Return the single shared/admin credential row, or None."""
    return db.query(ClaudeCredentials).filter(ClaudeCredentials.owner_id.is_(None)).first()


def _upsert(db: Session, owner_id: int | None, raw_credentials: str, label: str) -> ClaudeCredentials:
    validated = _validate(raw_credentials)
    row = (
        db.query(ClaudeCredentials)
        .filter(ClaudeCredentials.owner_id == owner_id)
        .first()
    )
    if row is None:
        row = ClaudeCredentials(owner_id=owner_id)
        db.add(row)
    meta = _extract_metadata(validated)
    row.credentials = crypto.encrypt(validated) or ""
    row.label = label
    row.status = STATUS_ACTIVE
    row.expires_at = meta["expires_at"]
    row.scopes = meta["scopes"]
    row.subscription_type = meta["subscription_type"]
    db.commit()
    db.refresh(row)
    return row


def upsert_own(db: Session, owner_id: int, raw_credentials: str, label: str = "") -> ClaudeCredentials:
    """Store/replace ``owner_id``'s own credentials file contents."""
    return _upsert(db, owner_id, raw_credentials, label)


def upsert_shared(db: Session, raw_credentials: str, label: str = "") -> ClaudeCredentials:
    """Store/replace the shared/admin credentials file contents."""
    return _upsert(db, None, raw_credentials, label)


def delete_own(db: Session, owner_id: int) -> bool:
    """Delete ``owner_id``'s own credential row. Returns True if one existed."""
    row = get_own(db, owner_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def delete_shared(db: Session) -> bool:
    """Delete the shared/admin credential row. Returns True if one existed."""
    row = get_shared(db)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def _meta_for(row: ClaudeCredentials | None, *, with_assigned_users: bool = False, db: Session | None = None) -> dict | None:
    """Public metadata for one credential row (never the token). ``None`` if
    ``row`` doesn't exist. ``assigned_users`` (shared credential only) counts
    active users who fall back to it, i.e. have no own credential."""
    if row is None:
        return None
    assigned_users = None
    if with_assigned_users and db is not None:
        from app.models.user import User

        owned_ids = {
            r[0]
            for r in db.query(ClaudeCredentials.owner_id)
            .filter(ClaudeCredentials.owner_id.isnot(None))
            .all()
        }
        assigned_users = (
            db.query(User).filter(User.is_active.is_(True), User.id.notin_(owned_ids)).count()
            if owned_ids
            else db.query(User).filter(User.is_active.is_(True)).count()
        )
    return {
        "subscription_type": row.subscription_type,
        "expires_at": row.expires_at,
        "scopes": row.scopes or [],
        "last_refreshed": row.updated_at,
        "assigned_users": assigned_users,
    }


def status_for(db: Session, owner_id: int | None) -> dict:
    """Status summary for the AI settings screen: never leaks the token itself.

    ``mode`` is the credential that will actually be used for this user per
    :func:`resolve_effective`'s precedence: "own" > "shared" > "none". ``own``
    and ``shared`` carry each row's metadata (subscription/expiry/scopes/last
    refresh), so the personal card and the admin shared-account card can both
    render from one call.
    """
    own_row = get_own(db, owner_id) if owner_id is not None else None
    shared_row = get_shared(db)
    has_own = own_row is not None
    has_shared = shared_row is not None
    mode = "own" if has_own else "shared" if has_shared else "none"
    return {
        "hasOwn": has_own,
        "hasShared": has_shared,
        "mode": mode,
        "own": _meta_for(own_row),
        "shared": _meta_for(shared_row, with_assigned_users=True, db=db),
    }


def resolve_ambient_owner_id() -> int | None:
    """Best-effort resolve the user id to attribute for the in-flight Claude CLI call.

    Claude CLI calls happen deep in :mod:`app.services.claude_cli`, invoked from
    run-scoped background worker threads that have no request/user object in
    scope. Those workers already set the ambient run id (see
    :mod:`app.services.run_context`) so per-run cost can be attributed; we reuse
    that same mechanism here and resolve the run's ``owner_id`` — the user whose
    credentials/usage this call belongs to. Returns ``None`` when there is no
    ambient run, the run can't be found, or it has no owner (pre-ownership data
    or shared/local-first use) — callers then fall back to the shared credential
    and unattributed usage, matching today's behavior.
    """
    from app.services import run_context

    run_id = run_context.get_run()
    if run_id is None:
        return None
    from app.db import SessionLocal
    from app.models.run import Run

    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        return run.owner_id if run is not None else None
    finally:
        db.close()


def _config_dir_for(key: str) -> Path:
    return settings.workspace_dir / "claude-config" / key


def _lock_down(path: Path, *, is_dir: bool) -> None:
    """Best-effort restrict permissions to the owner (no-op on failure/platforms
    where chmod has no effect, e.g. Windows) — never fatal."""
    try:
        path.chmod(stat.S_IRWXU if is_dir else (stat.S_IRUSR | stat.S_IWUSR))
    except OSError:
        pass


def materialize(row: ClaudeCredentials, key: str) -> Path:
    """Decrypt ``row.credentials`` and write it to ``workspace/claude-config/<key>/.credentials.json``.

    Returns the directory (not the file) — that's the value ``CLAUDE_CONFIG_DIR``
    is set to. Rewrites the file on every call so an updated stored credential
    (re-upload) always takes effect on the next CLI invocation.
    """
    config_dir = _config_dir_for(key)
    config_dir.mkdir(parents=True, exist_ok=True)
    _lock_down(config_dir, is_dir=True)

    decrypted = crypto.decrypt(row.credentials)
    if decrypted is None:
        raise ClaudeCredentialsError(f"stored credentials for '{key}' could not be decrypted")

    creds_path = config_dir / ".credentials.json"
    creds_path.write_text(decrypted, encoding="utf-8")
    _lock_down(creds_path, is_dir=False)
    return config_dir


def resolve_effective_config_dir(db: Session, owner_id: int | None) -> Path | None:
    """Resolve + materialize the effective credentials dir for ``owner_id``.

    Precedence: the user's own credential, else the shared/admin credential,
    else ``None`` (no credential configured at all — the caller must raise a
    clean error; there is no interactive ``claude login`` fallback per ADR 0001).
    """
    if owner_id is not None:
        own = get_own(db, owner_id)
        if own is not None:
            return materialize(own, str(owner_id))
    shared = get_shared(db)
    if shared is not None:
        return materialize(shared, "shared")
    return None
