"""Provider-connection resolution — split by category (ADR 0006).

Credentials are resolved along two independent paths:

- **Work-item** work (ticket fetch, sync, comment publish, work-item linking,
  project-key resolution) routes by the **ticket's** work-item connection
  (``ticket.connection_id`` → first work-item connection of the ticket's kind).
- **Repository** work (repo clone, knowledge build, repo discovery) routes by the
  **project's** ``repository_connection_id`` → first repository connection.

Nullable FKs plus first-of-category fallbacks keep un-bound paths working: a
legacy row or an un-configured project degrades to the first matching connection
rather than crashing.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import crypto
from app.models.project_config import ProjectConfig
from app.models.provider import Provider
from app.models.provider_connection import (
    PROVIDER_CATEGORY,
    PROVIDER_DISPLAY_NAMES,
    REPOSITORY,
    WORK_ITEM,
    ProviderConnection,
    category_for,
)
from app.models.ticket import Ticket
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderAdapter, ProviderError

__all__ = [
    "PROVIDER_CATEGORY",
    "REPOSITORY",
    "WORK_ITEM",
    "adapter_for",
    "backfill_from_providers",
    "category_for",
    "connections_by_category",
    "first_of_kind",
    "get_connection",
    "resolve_repository_for_project",
    "resolve_work_item_for_ticket",
]


# ------------------------------------------------------------------ helpers
def get_connection(db: Session, connection_id: int | None) -> ProviderConnection | None:
    """Return a connection by id, or None (also for a None/0 id)."""
    if not connection_id:
        return None
    return db.get(ProviderConnection, connection_id)


def first_of_kind(db: Session, kind: str) -> ProviderConnection | None:
    """First connection of a provider kind (ordered by id), or None."""
    return (
        db.query(ProviderConnection)
        .filter(ProviderConnection.kind == kind)
        .order_by(ProviderConnection.id)
        .first()
    )


def connections_by_category(db: Session, category: str) -> list[ProviderConnection]:
    """All connections whose kind belongs to ``category`` (work_item|repository)."""
    kinds = [k for k, c in PROVIDER_CATEGORY.items() if c == category]
    if not kinds:
        return []
    return (
        db.query(ProviderConnection)
        .filter(ProviderConnection.kind.in_(kinds))
        .order_by(ProviderConnection.id)
        .all()
    )


def _first_of_category(db: Session, category: str) -> ProviderConnection | None:
    conns = connections_by_category(db, category)
    return conns[0] if conns else None


def adapter_for(db: Session, connection: ProviderConnection) -> ProviderAdapter:  # noqa: ARG001
    """Build a live adapter for a connection (decrypt secrets + ``get_adapter``)."""
    decrypted = {k: crypto.decrypt(v) for k, v in (connection.secrets or {}).items()}
    return get_adapter(connection.kind, connection.config or {}, decrypted)


# ----------------------------------------------------------- work-item routing
def resolve_work_item_for_ticket(db: Session, ticket: Ticket) -> ProviderConnection:
    """Resolve the work-item connection a ticket's work should route through.

    Order: the ticket's stamped ``connection_id`` → the first work-item connection
    of the ticket's ``provider_kind`` → :class:`ProviderError`.
    """
    conn = get_connection(db, ticket.connection_id)
    if conn is not None:
        return conn
    conn = first_of_kind(db, ticket.provider_kind)
    if conn is not None and category_for(conn.kind) == WORK_ITEM:
        return conn
    raise ProviderError(
        f"Work-item provider '{ticket.provider_kind}' is not configured"
    )


# ---------------------------------------------------------- repository routing
def resolve_repository_for_project(db: Session, project_key: str | None) -> ProviderConnection:
    """Resolve the repository connection a project's code work routes through.

    Order: the project's bound ``repository_connection_id`` → the first repository
    connection → :class:`ProviderError`.
    """
    if project_key:
        cfg = db.query(ProjectConfig).filter(ProjectConfig.key == project_key).first()
        if cfg is not None:
            conn = get_connection(db, cfg.repository_connection_id)
            if conn is not None:
                return conn
    conn = _first_of_category(db, REPOSITORY)
    if conn is not None:
        return conn
    raise ProviderError("Repository provider is not configured")


# ---------------------------------------------------------------- backfill
def backfill_from_providers(db: Session) -> None:
    """One-time migration from legacy ``providers`` to ``provider_connections``.

    Best-effort (mirrors ``_backfill_audit``): copies each legacy Provider into a
    ProviderConnection when the new table is empty, then binds every ProjectConfig
    with null bindings to the first connection of each category and stamps each
    un-stamped ticket's ``connection_id`` from the matching work-item connection.
    Idempotent — the copy is guarded by an emptiness check and only null bindings
    are filled.
    """
    if db.query(ProviderConnection).count() == 0:
        for p in db.query(Provider).all():
            db.add(
                ProviderConnection(
                    kind=p.kind,
                    name=p.name or PROVIDER_DISPLAY_NAMES.get(p.kind, p.kind.upper()),
                    connected=bool(p.connected),
                    config=p.config or {},
                    secrets=p.secrets or {},
                    last_sync=p.last_sync,
                )
            )
        db.commit()

    work_item = _first_of_category(db, WORK_ITEM)
    repository = _first_of_category(db, REPOSITORY)
    for cfg in db.query(ProjectConfig).all():
        if cfg.work_item_connection_id is None and work_item is not None:
            cfg.work_item_connection_id = work_item.id
        if cfg.repository_connection_id is None and repository is not None:
            cfg.repository_connection_id = repository.id

    for ticket in db.query(Ticket).filter(Ticket.connection_id.is_(None)).all():
        conn = first_of_kind(db, ticket.provider_kind)
        if conn is not None and category_for(conn.kind) == WORK_ITEM:
            ticket.connection_id = conn.id
    db.commit()
