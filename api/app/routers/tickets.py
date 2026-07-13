"""Tickets router.

Endpoints to implement:
  GET  /tickets                     -> TicketPageOut         (query: status, assignee, sprint,
                                                                connection_id, provider_kind,
                                                                priority, epic, q, page, page_size)
  GET  /tickets/{external_id}        -> TicketDetailOut
  POST /tickets/sync                 -> SyncResult           (body: SyncRequest; live adapter pull)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db, utcnow
from app.deps_auth import current_user
from app.models.linked import LinkedTestCase
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas import (
    LinkedTestCaseOut,
    SyncRequest,
    SyncResult,
    TicketDetailOut,
    TicketOut,
    TicketPageOut,
)
from app.services import audit_service, connection_service
from app.services.adapters.base import ProviderError
from app.services.ownership import owned, stamp_owner

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("", response_model=TicketPageOut)
def list_tickets(
    status: str | None = None,
    assignee: str | None = None,
    sprint: str | None = None,
    # Multi-word query params are camelCase on the wire (matching the rest of the
    # API: request bodies + responses). FastAPI needs an explicit alias to bind
    # snake_case handler args to those camelCase names.
    area_path: str | None = Query(None, alias="areaPath"),
    states: str | None = None,  # comma-separated
    work_item_types: str | None = Query(None, alias="workItemTypes"),  # comma-separated
    q: str | None = None,
    connection_id: int | None = Query(None, alias="connectionId"),
    provider_kind: str | None = Query(None, alias="providerKind"),
    priority: str | None = None,
    epic: str | None = None,
    page: int = 1,
    page_size: int = Query(25, alias="pageSize"),
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> TicketPageOut:
    """Tickets scoped to ``user`` (#93 — private per-user data)."""
    query = owned(db.query(Ticket), Ticket, user)
    if connection_id:
        query = query.filter(Ticket.connection_id == connection_id)
    if provider_kind:
        query = query.filter(Ticket.provider_kind == provider_kind)
    if status:
        query = query.filter(Ticket.status == status)
    if assignee:
        query = query.filter(Ticket.assignee == assignee)
    if sprint:
        query = query.filter(Ticket.sprint == sprint)
    if area_path:
        # UNDER semantics: the selected area path and its children. Use
        # startswith(autoescape=True) rather than a raw LIKE: ADO area paths
        # contain backslashes (e.g. "Surency\\Data Platform") and Postgres LIKE
        # treats backslash as its default ESCAPE char, so a raw
        # `LIKE 'Surency\\Data Platform%'` collapses to `SurencyData Platform%`
        # and matches nothing. autoescape emits `ESCAPE '/'` and escapes %/_ in
        # the value, keeping backslashes literal.
        query = query.filter(Ticket.area_path.startswith(area_path, autoescape=True))
    state_list = [s for s in (states or "").split(",") if s]
    if state_list:
        query = query.filter(Ticket.status.in_(state_list))
    type_list = [t for t in (work_item_types or "").split(",") if t]
    if type_list:
        query = query.filter(Ticket.work_item_type.in_(type_list))
    if priority:
        query = query.filter(Ticket.priority == priority)
    if epic:
        query = query.filter(Ticket.epic == epic)
    if q:
        like = f"%{q}%"
        query = query.filter((Ticket.title.ilike(like)) | (Ticket.external_id.ilike(like)))

    total = query.count()
    items = (
        query.order_by(Ticket.synced_at.desc().nullslast(), Ticket.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return TicketPageOut(
        items=[TicketOut.model_validate(t) for t in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{external_id}", response_model=TicketDetailOut)
def get_ticket(
    external_id: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> TicketDetailOut:
    """Scoped to ``user`` (#93 — private per-user data)."""
    ticket = owned(db.query(Ticket), Ticket, user).filter(Ticket.external_id == external_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket '{external_id}' not found")

    # Comments are skipped during bulk sync (N+1). Load them lazily on first view,
    # routed through the ticket's work-item connection.
    if not ticket.comments:
        try:
            connection = connection_service.resolve_work_item_for_ticket(db, ticket)
            adapter = connection_service.adapter_for(db, connection)
            comments = adapter.fetch_comments(external_id)
            if comments:
                ticket.comments = comments
                db.commit()
                db.refresh(ticket)
        except Exception:  # noqa: BLE001 - detail must never fail on comment fetch
            db.rollback()

    return TicketDetailOut.model_validate(ticket)


@router.get("/{external_id}/linked-cases", response_model=list[LinkedTestCaseOut])
def linked_cases(external_id: str, db: Session = Depends(get_db)) -> list[LinkedTestCase]:
    """Test cases created in the provider and linked to this work item."""
    return (
        db.query(LinkedTestCase)
        .filter(LinkedTestCase.ticket_external_id == external_id)
        .order_by(LinkedTestCase.id.desc())
        .all()
    )


@router.get("/{external_id}/provider-test-cases")
def provider_test_cases(external_id: str, db: Session = Depends(get_db)) -> list[dict]:
    """Existing test cases in the provider (e.g. ADO Test Case work items).

    Lets the app show/manage test cases that already live in the provider, and is
    what generation reads to continue the existing numbering/naming convention.
    """
    ticket = db.query(Ticket).filter(Ticket.external_id == external_id).first()
    if ticket is None:
        return []
    try:
        connection = connection_service.resolve_work_item_for_ticket(db, ticket)
        adapter = connection_service.adapter_for(db, connection)
        items = adapter.list_test_cases(external_id)
    except Exception:  # noqa: BLE001 - degrade gracefully (provider/network hiccup)
        return []
    return [
        {"externalId": tc.get("external_id", ""), "title": tc.get("title", ""), "state": tc.get("state", "")}
        for tc in items
    ]


@router.post("/sync", response_model=SyncResult)
def sync_tickets(
    body: SyncRequest, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> SyncResult:
    """Pull tickets from a work-item connection's adapter and upsert Ticket rows.

    Routes by the request's ``connectionId`` (a work-item connection); falls back
    to the first connection of ``providerKind``. Each synced ticket is stamped with
    the connection's id so downstream work-item work routes back to the same origin.
    Both the connection and the synced tickets are scoped to ``user`` (#93 —
    private per-user data): a user only ever syncs via, and into, their own data.
    """
    owner_id = user.id if user else None
    connection = connection_service.get_connection(db, body.connection_id, owner_id=owner_id)
    if connection is None and body.provider_kind:
        connection = connection_service.first_of_kind(db, body.provider_kind, owner_id=owner_id)
    if connection is None:
        raise HTTPException(
            status_code=404,
            detail=f"No work-item connection is configured for '{body.provider_kind or body.connection_id}'",
        )

    try:
        adapter = connection_service.adapter_for(db, connection)
        fetched = adapter.fetch_tickets(
            mode=body.mode,
            sprint=body.sprint,
            sprint_path=body.sprint_path,
            area_path=body.area_path,
            states=body.states,
            work_item_types=body.work_item_types,
            ticket_ids=body.ticket_ids,
        )
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    synced: list[Ticket] = []
    for item in fetched:
        external_id = str(item.get("external_id", ""))
        if not external_id:
            continue
        ticket = (
            owned(db.query(Ticket), Ticket, user)
            .filter(Ticket.external_id == external_id, Ticket.provider_kind == connection.kind)
            .first()
        )
        if not ticket:
            ticket = stamp_owner(Ticket(external_id=external_id, provider_kind=connection.kind), user)
            db.add(ticket)
        ticket.connection_id = connection.id  # stamp the work-item origin

        ticket.title = item.get("title", ticket.title if ticket.id else "")
        ticket.work_item_type = item.get("work_item_type", "User Story")
        ticket.status = item.get("status", "")
        ticket.priority = item.get("priority", "Medium")
        ticket.assignee = item.get("assignee", "")
        ticket.sprint = item.get("sprint", "")
        ticket.area_path = item.get("area_path", "")
        ticket.epic = item.get("epic", "")
        ticket.description = item.get("description", "")
        ticket.note = item.get("note", "")
        ticket.labels = item.get("labels", [])
        ticket.acceptance_criteria = item.get("acceptance_criteria", [])
        ticket.comments = item.get("comments", [])
        ticket.attachments = item.get("attachments", [])
        ticket.linked_prs = item.get("linked_prs", [])
        synced.append(ticket)

    connection.last_sync = utcnow()
    db.commit()
    for ticket in synced:
        db.refresh(ticket)

    audit_service.record(
        category="sync", actor_type="system", action="Synced tickets",
        target=body.sprint or connection.name or connection.kind,
        meta=f"{len(synced)} work items",
    )

    return SyncResult(synced=len(synced), tickets=[TicketOut.model_validate(t) for t in synced])
