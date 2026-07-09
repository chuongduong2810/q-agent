"""Per-user ownership scoping helpers (#91 — the shared foundation).

Every owned entity (``runs``, ``tickets``, ``projects``, ``project_config``,
``provider_connections``, ``claude_usage``, ``project_knowledge``) carries a
nullable ``owner_id`` FK -> ``users.id`` (see the ``48496117f693`` migration).
These three helpers are the single place ownership is checked/applied so the
later per-domain slices (#92 runs, #93 config) stay consistent instead of
each router re-implementing the check.

# BRIDGE (#91): every helper below is a no-op — or treats a ``None``/unset
owner as accessible — when ``user`` is ``None``. This keeps the existing test
suite (which runs with ``settings.auth_required`` off, so ``current_user``
resolves to ``None``) and any not-yet-migrated router green. The bridge is
removed by the cleanup issue (#98), once every write path stamps an owner and
every read path is required to pass a real user.
"""

from __future__ import annotations

from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Query, Session

from app.models.user import User

ModelT = TypeVar("ModelT")


def owned(query: Query[ModelT], model: type[ModelT], user: User | None) -> Query[ModelT]:
    """Restrict ``query`` to rows owned by ``user``.

    ``model`` must declare an ``owner_id`` column.

    # BRIDGE (#91): a no-op passthrough when ``user`` is ``None`` — the query
    is returned unfiltered, matching today's global-visibility behavior.
    """
    if user is None:
        return query
    return query.filter(model.owner_id == user.id)


def _ownership_mismatch(obj: object, user: User | None) -> bool:
    """True when ``user`` is present and ``obj.owner_id`` names a *different* user.

    A row with no owner (``owner_id`` is ``None`` — pre-ownership data) never
    mismatches, so legacy/un-stamped rows stay accessible to everyone.
    """
    owner_id = getattr(obj, "owner_id", None)
    return user is not None and owner_id is not None and owner_id != user.id


def get_owned_or_404(db: Session, model: type[ModelT], id: int, user: User | None) -> ModelT:
    """Fetch ``model`` by primary key ``id``.

    Raises 404 when the row is missing, or when ``user`` is present and the
    row is owned by a *different* user. A row with no owner (``owner_id`` is
    ``None`` — pre-ownership data) is always accessible.

    # BRIDGE (#91): when ``user`` is ``None`` the ownership check is skipped
    entirely — any existing row is returned, matching today's behavior.
    """
    obj = db.get(model, id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{model.__name__} not found")
    if _ownership_mismatch(obj, user):
        raise HTTPException(status_code=404, detail=f"{model.__name__} not found")
    return obj


def check_owned_or_404(obj: object | None, user: User | None, *, not_found: str = "Not found") -> None:
    """Raise 404 when ``obj`` exists and is owned by a *different* user (#93).

    Complements :func:`get_owned_or_404` for models looked up by a non-primary-key
    field (e.g. ``ProjectConfig``/``ProjectKnowledge``, both keyed by ``key`` — a
    string — rather than ``id``): the caller fetches the row itself (or ``None``),
    then calls this to apply the same bridge-aware ownership check. A no-op when
    ``obj`` is ``None`` or ``user`` is ``None``.
    """
    if obj is not None and _ownership_mismatch(obj, user):
        raise HTTPException(status_code=404, detail=not_found)


def stamp_owner(obj: ModelT, user: User | None) -> ModelT:
    """Set ``obj.owner_id`` to ``user.id`` when a current user is present.

    Returns ``obj`` (for chaining at the call site, e.g. ``db.add(stamp_owner(...))``).

    # BRIDGE (#91): a no-op when ``user`` is ``None`` — ``owner_id`` is left
    unset, matching the nullable column added by the ownership migration.
    """
    if user is not None:
        obj.owner_id = user.id
    return obj
