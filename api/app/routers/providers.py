"""Providers + Settings router.

Provider connections (ADR 0006 revision 2) — a provider *kind* holds many named
``ProviderConnection`` rows, and a kind may carry one or more capabilities
(work_item / repository — Azure DevOps carries both):

  GET    /providers                          -> list[ProviderGroupOut]  (grouped catalog)
  POST   /providers/{kind}/connections        -> ConnectionOut           (create empty)
  PUT    /connections/{id}                     -> ConnectionOut           (save config + secrets)
  DELETE /connections/{id}                     -> 204                     (null referencing FKs)
  POST   /connections/{id}/test                -> TestConnectionResult    (live probe)
  GET    /connections/{id}/sprints             -> list[SprintOut]         (work-item)
  GET    /connections/{id}/work-item-metadata  -> WorkItemMetadataOut     (work-item)
  GET    /connections/{id}/repos               -> AvailableReposOut  (repository)
  GET    /settings                             -> SettingsOut
  PUT    /settings                             -> SettingsOut

This router has no prefix — provider/connection paths are spelled out explicitly.
``app/main.py`` includes this single ``router`` object.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app import crypto
from app.db import get_db, utcnow
from app.deps_auth import current_user
from app.logging import logger
from app.models.project import Project
from app.models.project_config import ProjectConfig
from app.models.provider import PROVIDER_KINDS
from app.models.provider_connection import (
    PROVIDER_DISPLAY_NAMES,
    REPOSITORY,
    WORK_ITEM,
    ProviderConnection,
    categories_for,
)
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas import (
    AvailableReposOut,
    ConnectionCreate,
    ConnectionOut,
    ConnectionUpdate,
    ProviderGroupOut,
    SettingsOut,
    SettingsUpdate,
    SprintOut,
    TestConnectionResult,
    WorkItemMetadataOut,
)
from app.services import audit_service, settings_store
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError
from app.services.ownership import get_owned_or_404, owned, stamp_owner

router = APIRouter(tags=["providers"])

# Fixed kind order for the grouped catalog: ado, jira, github.
_KIND_ORDER = list(PROVIDER_KINDS)


def _validate_kind(kind: str) -> None:
    if kind not in PROVIDER_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown provider kind '{kind}'")


def _to_connection_out(conn: ProviderConnection) -> ConnectionOut:
    """Build a ConnectionOut with secrets replaced by their field names only."""
    return ConnectionOut(
        id=conn.id,
        kind=conn.kind,
        categories=list(categories_for(conn.kind)),
        name=conn.name,
        connected=conn.connected,
        config=conn.config or {},
        secret_fields=sorted((conn.secrets or {}).keys()),
        last_sync=conn.last_sync,
        last_tested_at=conn.last_tested_at,
    )


def _get_connection_or_404(db: Session, connection_id: int, user: User | None) -> ProviderConnection:
    """Fetch a connection by id, scoped to ``user`` (#93 — private per-user data).

    Delegates the 404 semantics to :func:`get_owned_or_404`: missing row, or a
    row owned by a *different* user, both 404. A no-op when ``user`` is ``None``
    (auth disabled).
    """
    return get_owned_or_404(db, ProviderConnection, connection_id, user)


def _require_capability(conn: ProviderConnection, capability: str) -> None:
    if capability not in categories_for(conn.kind):
        raise HTTPException(
            status_code=400,
            detail=f"Connection '{conn.id}' ({conn.kind}) is not a {capability} provider",
        )


@router.get("/providers", response_model=list[ProviderGroupOut])
def list_providers(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[ProviderGroupOut]:
    """Grouped catalog: one group per kind, in fixed order (ado, jira, github).

    Connections are scoped to ``user`` (#93) — each user only sees their own.
    """
    by_kind: dict[str, list[ProviderConnection]] = {k: [] for k in _KIND_ORDER}
    query = owned(db.query(ProviderConnection), ProviderConnection, user)
    for conn in query.order_by(ProviderConnection.id).all():
        by_kind.setdefault(conn.kind, []).append(conn)
    groups: list[ProviderGroupOut] = []
    for kind in _KIND_ORDER:
        conns = by_kind.get(kind, [])
        groups.append(
            ProviderGroupOut(
                kind=kind,
                categories=list(categories_for(kind)),
                name=PROVIDER_DISPLAY_NAMES.get(kind, kind.upper()),
                connection_count=len(conns),
                connected_count=sum(1 for c in conns if c.connected),
                connections=[_to_connection_out(c) for c in conns],
            )
        )
    return groups


@router.post("/providers/{kind}/connections", response_model=ConnectionOut, status_code=201)
def create_connection(
    kind: str,
    body: ConnectionCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> ConnectionOut:
    """Create an empty connection under a provider kind."""
    _validate_kind(kind)
    conn = ProviderConnection(
        kind=kind,
        name=body.name or PROVIDER_DISPLAY_NAMES.get(kind, kind.upper()),
        connected=False,
        config={},
        secrets={},
    )
    stamp_owner(conn, user)
    db.add(conn)
    db.commit()
    db.refresh(conn)
    audit_service.record(
        category="integration", actor_type="user", action="Added provider connection",
        target=conn.name or kind,
    )
    return _to_connection_out(conn)


@router.put("/connections/{connection_id}", response_model=ConnectionOut)
def update_connection(
    connection_id: int,
    body: ConnectionUpdate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> ConnectionOut:
    """Save non-secret config + encrypt and persist secrets. Untouched secrets kept."""
    conn = _get_connection_or_404(db, connection_id, user)
    if body.name is not None:
        conn.name = body.name
    if body.config is not None:
        conn.config = {**(conn.config or {}), **body.config}
    if body.secrets:
        encrypted = {**(conn.secrets or {})}
        for key, value in body.secrets.items():
            encrypted[key] = crypto.encrypt(value)
        conn.secrets = encrypted
    db.commit()
    db.refresh(conn)
    audit_service.record(
        category="integration", actor_type="user", action="Saved provider connection",
        target=conn.name or conn.kind,
    )
    return _to_connection_out(conn)


@router.delete("/connections/{connection_id}", status_code=204)
def delete_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> Response:
    """Delete a connection and null out every FK that referenced it."""
    conn = _get_connection_or_404(db, connection_id, user)
    db.query(Ticket).filter(Ticket.connection_id == connection_id).update(
        {Ticket.connection_id: None}, synchronize_session=False
    )
    db.query(Project).filter(Project.connection_id == connection_id).update(
        {Project.connection_id: None}, synchronize_session=False
    )
    db.query(ProjectConfig).filter(ProjectConfig.work_item_connection_id == connection_id).update(
        {ProjectConfig.work_item_connection_id: None}, synchronize_session=False
    )
    db.query(ProjectConfig).filter(ProjectConfig.repository_connection_id == connection_id).update(
        {ProjectConfig.repository_connection_id: None}, synchronize_session=False
    )
    name = conn.name or conn.kind
    db.delete(conn)
    db.commit()
    audit_service.record(
        category="integration", actor_type="user", action="Removed provider connection",
        target=name,
    )
    return Response(status_code=204)


@router.post("/connections/{connection_id}/test", response_model=TestConnectionResult)
def test_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> TestConnectionResult:
    """Instantiate the live adapter with decrypted config/secrets and probe connectivity."""
    conn = _get_connection_or_404(db, connection_id, user)
    decrypted = {key: crypto.decrypt(value) for key, value in (conn.secrets or {}).items()}
    try:
        adapter = get_adapter(conn.kind, conn.config or {}, decrypted)
        result = adapter.test_connection()
    except ProviderError as exc:
        result = {"ok": False, "message": str(exc), "detail": {}}

    conn.connected = bool(result.get("ok"))
    conn.last_tested_at = utcnow()
    db.commit()

    audit_service.record(
        category="integration", actor_type="user", action="Tested connection",
        target=conn.name or conn.kind,
        status="success" if result.get("ok") else "error",
        meta=result.get("message", ""),
    )
    return TestConnectionResult(
        ok=result.get("ok", False),
        message=result.get("message", ""),
        detail=result.get("detail", {}) or {},
    )


@router.get("/connections/{connection_id}/sprints", response_model=list[SprintOut])
def list_connection_sprints(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> list[SprintOut]:
    """Real sprints/iterations for a work-item connection's project.

    Resilient: an unconfigured/unsupported connection yields an empty list so the
    sprint picker degrades gracefully rather than erroring the UI.
    """
    conn = _get_connection_or_404(db, connection_id, user)
    _require_capability(conn, WORK_ITEM)
    decrypted = {key: crypto.decrypt(value) for key, value in (conn.secrets or {}).items()}
    try:
        adapter = get_adapter(conn.kind, conn.config or {}, decrypted)
        sprints = adapter.list_sprints()
    except Exception as exc:  # noqa: BLE001 - upstream/API hiccup shouldn't 500 the picker
        logger.warning("Sprint list for connection {} unavailable: {}", connection_id, exc)
        return []
    return [SprintOut.model_validate(s) for s in sprints]


@router.get("/connections/{connection_id}/work-item-metadata", response_model=WorkItemMetadataOut)
def connection_work_item_metadata(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> WorkItemMetadataOut:
    """Filter options (area paths, work item types, states) for a work-item connection.

    Resilient: unconfigured/unsupported connections yield empty lists.
    """
    conn = _get_connection_or_404(db, connection_id, user)
    _require_capability(conn, WORK_ITEM)
    decrypted = {key: crypto.decrypt(value) for key, value in (conn.secrets or {}).items()}
    try:
        adapter = get_adapter(conn.kind, conn.config or {}, decrypted)
        meta = adapter.list_work_item_metadata()
    except Exception as exc:  # noqa: BLE001 - never error the filter UI
        logger.warning("Work-item metadata for connection {} unavailable: {}", connection_id, exc)
        return WorkItemMetadataOut()
    return WorkItemMetadataOut.model_validate(meta)


@router.get("/connections/{connection_id}/repos", response_model=AvailableReposOut)
def list_connection_repos(
    connection_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> dict:
    """Discover the repositories a repository connection exposes (for the picker).

    Returns the ``{provider, repos, error}`` wrapper (matching
    ``/projects/{key}/repos/available`` and the TypeScript ``AvailableReposOut``
    client type) so the picker renders discovered repos — and surfaces a
    message on an upstream hiccup — instead of receiving a bare list it can't
    read and silently showing nothing.
    """
    conn = _get_connection_or_404(db, connection_id, user)
    _require_capability(conn, REPOSITORY)
    decrypted = {key: crypto.decrypt(value) for key, value in (conn.secrets or {}).items()}
    try:
        adapter = get_adapter(conn.kind, conn.config or {}, decrypted)
        repos = adapter.list_repos()
    except ProviderError as exc:
        return {"provider": conn.kind, "repos": [], "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - never 500 the picker on an upstream hiccup
        logger.warning("Repo list for connection {} unavailable: {}", connection_id, exc)
        return {"provider": conn.kind, "repos": [], "error": f"Could not list repos: {exc}"}
    return {"provider": conn.kind, "repos": repos, "error": ""}


@router.get("/settings", response_model=SettingsOut, tags=["settings"])
def get_settings_endpoint() -> SettingsOut:
    return SettingsOut.model_validate(settings_store.load_settings())


@router.put("/settings", response_model=SettingsOut, tags=["settings"])
def update_settings_endpoint(body: SettingsUpdate) -> SettingsOut:
    updates = body.model_dump(by_alias=False, exclude_none=True)
    # settings_store keys are camelCase to match SettingsOut fields directly.
    camel_updates = {
        "parallel": updates.get("parallel"),
        "retryFlaky": updates.get("retry_flaky"),
        "screenshotOnFail": updates.get("screenshot_on_fail"),
        "video": updates.get("video"),
        "maxCasesPerTicket": updates.get("max_cases_per_ticket"),
        "headless": updates.get("headless"),
        "autoAnnotate": updates.get("auto_annotate"),
        "neuralBackground": updates.get("neural_background"),
        "claudeModel": updates.get("claude_model"),
        "weeklyTokenBudget": updates.get("weekly_token_budget"),
    }
    saved = settings_store.save_settings(camel_updates)
    _changed = ", ".join(k for k, v in camel_updates.items() if v is not None)
    audit_service.record(
        category="settings", actor_type="user", action="Changed settings",
        target="Workspace settings", meta=_changed,
    )
    return SettingsOut.model_validate(saved)
