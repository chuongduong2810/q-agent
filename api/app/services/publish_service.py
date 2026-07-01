"""Publish orchestration — pushes a prepared TicketComment to its provider.

Resolves the ticket's provider, decrypts its stored secrets, builds a live
adapter (per ADR 0001 — real REST calls, no simulated fallback), posts the
comment body, optionally transitions the work item status, and records the
outcome on the TicketComment row. Emits `publish.status` WS events so run-scoped
screens can reflect progress live.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import crypto
from app.models.comment import TicketComment
from app.models.provider import Provider
from app.models.ticket import Ticket
from app.services.adapters import ProviderError, get_adapter
from app.ws import hub


def _build_adapter(db: Session, provider_kind: str):
    """Load the Provider row for ``provider_kind``, decrypt secrets, build an adapter."""
    provider = db.execute(select(Provider).where(Provider.kind == provider_kind)).scalars().first()
    if provider is None:
        raise ProviderError(f"Provider '{provider_kind}' is not configured")
    decrypted_secrets = {k: crypto.decrypt(v) for k, v in (provider.secrets or {}).items()}
    return get_adapter(provider_kind, provider.config or {}, decrypted_secrets)


def _resolve_provider_kind(db: Session, comment: TicketComment) -> str:
    if comment.provider_kind:
        return comment.provider_kind
    ticket = (
        db.execute(select(Ticket).where(Ticket.external_id == comment.ticket_external_id))
        .scalars()
        .first()
    )
    if ticket is None:
        raise ProviderError(f"Ticket '{comment.ticket_external_id}' not found")
    return ticket.provider_kind


def publish_one(db: Session, comment: TicketComment) -> TicketComment:
    """Publish a single draft/failed comment to its provider and persist the outcome.

    On success sets status='published' + external_comment_id, and applies the
    target_status transition on the ticket if one was set. On failure sets
    status='failed' + error_message. Always emits a `publish.status` WS event.
    """
    comment.status = "publishing"
    db.add(comment)
    db.commit()
    hub.publish(
        str(comment.run_id), "publish.status", {"ticket": comment.ticket_external_id, "status": "publishing"}
    )

    try:
        provider_kind = _resolve_provider_kind(db, comment)
        adapter = _build_adapter(db, provider_kind)
        external_id = adapter.publish_comment(
            comment.ticket_external_id, comment.body, attachments=comment.attachments or None
        )
        if comment.target_status:
            adapter.update_status(comment.ticket_external_id, comment.target_status)
    except Exception as exc:  # noqa: BLE001 - surface any adapter/provider failure
        comment.status = "failed"
        comment.error_message = str(exc)
        db.add(comment)
        db.commit()
        db.refresh(comment)
        hub.publish(
            str(comment.run_id),
            "publish.status",
            {"ticket": comment.ticket_external_id, "status": "failed"},
        )
        return comment

    comment.status = "published"
    comment.external_comment_id = external_id
    comment.error_message = ""
    db.add(comment)
    db.commit()
    db.refresh(comment)
    hub.publish(
        str(comment.run_id), "publish.status", {"ticket": comment.ticket_external_id, "status": "published"}
    )
    return comment
