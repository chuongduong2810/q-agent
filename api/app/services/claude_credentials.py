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
    row.credentials = crypto.encrypt(validated) or ""
    row.label = label
    row.status = STATUS_ACTIVE
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


def status_for(db: Session, owner_id: int | None) -> dict:
    """Status summary for the AI settings screen: never leaks the token itself.

    ``mode`` is the credential that will actually be used for this user per
    :func:`resolve_effective`'s precedence: "own" > "shared" > "none".
    """
    has_own = owner_id is not None and get_own(db, owner_id) is not None
    has_shared = get_shared(db) is not None
    mode = "own" if has_own else "shared" if has_shared else "none"
    return {"hasOwn": has_own, "hasShared": has_shared, "mode": mode}


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
