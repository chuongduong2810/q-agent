"""Tickets router.

Endpoints to implement:
  GET  /tickets                     -> list[TicketOut]      (query: status, assignee, sprint, q)
  GET  /tickets/{external_id}        -> TicketDetailOut
  POST /tickets/sync                 -> SyncResult           (body: SyncRequest; live adapter pull)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crypto
from app.db import get_db, utcnow
from app.models.linked import LinkedTestCase
from app.models.provider import Provider
from app.models.ticket import Ticket
from app.schemas import (
    LinkedTestCaseOut,
    SyncRequest,
    SyncResult,
    TicketDetailOut,
    TicketOut,
)
from app.services import audit_service
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.get("", response_model=list[TicketOut])
def list_tickets(
    status: str | None = None,
    assignee: str | None = None,
    sprint: str | None = None,
    area_path: str | None = None,
    states: str | None = None,  # comma-separated
    work_item_types: str | None = None,  # comma-separated
    q: str | None = None,
    db: Session = Depends(get_db),
) -> list[TicketOut]:
    query = db.query(Ticket)
    if status:
        query = query.filter(Ticket.status == status)
    if assignee:
        query = query.filter(Ticket.assignee == assignee)
    if sprint:
        query = query.filter(Ticket.sprint == sprint)
    if area_path:
        # UNDER semantics: the selected area path and its children.
        query = query.filter(Ticket.area_path.like(f"{area_path}%"))
    state_list = [s for s in (states or "").split(",") if s]
    if state_list:
        query = query.filter(Ticket.status.in_(state_list))
    type_list = [t for t in (work_item_types or "").split(",") if t]
    if type_list:
        query = query.filter(Ticket.work_item_type.in_(type_list))
    if q:
        like = f"%{q}%"
        query = query.filter((Ticket.title.ilike(like)) | (Ticket.external_id.ilike(like)))
    return [TicketOut.model_validate(t) for t in query.all()]


@router.get("/{external_id}", response_model=TicketDetailOut)
def get_ticket(external_id: str, db: Session = Depends(get_db)) -> TicketDetailOut:
    ticket = db.query(Ticket).filter(Ticket.external_id == external_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket '{external_id}' not found")

    # Comments are skipped during bulk sync (N+1). Load them lazily on first view.
    if not ticket.comments:
        provider = db.query(Provider).filter(Provider.kind == ticket.provider_kind).first()
        if provider:
            decrypted = {k: crypto.decrypt(v) for k, v in (provider.secrets or {}).items()}
            try:
                adapter = get_adapter(provider.kind, provider.config or {}, decrypted)
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
    kind = ticket.provider_kind if ticket else "ado"
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        return []
    decrypted = {k: crypto.decrypt(v) for k, v in (provider.secrets or {}).items()}
    try:
        adapter = get_adapter(kind, provider.config or {}, decrypted)
        items = adapter.list_test_cases(external_id)
    except Exception:  # noqa: BLE001 - degrade gracefully (provider/network hiccup)
        return []
    return [
        {"externalId": tc.get("external_id", ""), "title": tc.get("title", ""), "state": tc.get("state", "")}
        for tc in items
    ]


@router.post("/sync", response_model=SyncResult)
def sync_tickets(body: SyncRequest, db: Session = Depends(get_db)) -> SyncResult:
    """Pull tickets from the given provider's adapter and upsert Ticket rows."""
    provider = db.query(Provider).filter(Provider.kind == body.provider_kind).first()
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{body.provider_kind}' is not configured")

    decrypted_secrets = {key: crypto.decrypt(value) for key, value in (provider.secrets or {}).items()}

    try:
        adapter = get_adapter(provider.kind, provider.config or {}, decrypted_secrets)
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
            db.query(Ticket)
            .filter(Ticket.external_id == external_id, Ticket.provider_kind == provider.kind)
            .first()
        )
        if not ticket:
            ticket = Ticket(external_id=external_id, provider_kind=provider.kind)
            db.add(ticket)

        ticket.title = item.get("title", ticket.title if ticket.id else "")
        ticket.work_item_type = item.get("work_item_type", "User Story")
        ticket.status = item.get("status", "")
        ticket.priority = item.get("priority", "Medium")
        ticket.assignee = item.get("assignee", "")
        ticket.sprint = item.get("sprint", "")
        ticket.area_path = item.get("area_path", "")
        ticket.description = item.get("description", "")
        ticket.note = item.get("note", "")
        ticket.labels = item.get("labels", [])
        ticket.acceptance_criteria = item.get("acceptance_criteria", [])
        ticket.comments = item.get("comments", [])
        ticket.attachments = item.get("attachments", [])
        ticket.linked_prs = item.get("linked_prs", [])
        synced.append(ticket)

    provider.last_sync = utcnow()
    db.commit()
    for ticket in synced:
        db.refresh(ticket)

    audit_service.record(
        category="sync", actor_type="system", action="Synced tickets",
        target=body.sprint or provider.name or provider.kind,
        meta=f"{len(synced)} work items",
    )

    return SyncResult(synced=len(synced), tickets=[TicketOut.model_validate(t) for t in synced])
