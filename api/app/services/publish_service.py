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
from app.models.ticket import Ticket
from app.services import audit_service, connection_service
from app.services.adapters import ProviderError, get_adapter
from app.ws import hub


def _resolve_connection(db: Session, comment: TicketComment):
    """Resolve the work-item connection a comment publishes through (ADR 0006).

    Routes by the comment's ticket → its work-item connection. Falls back to the
    first connection of the comment's stamped ``provider_kind`` when the ticket
    row is missing.
    """
    ticket = (
        db.execute(select(Ticket).where(Ticket.external_id == comment.ticket_external_id))
        .scalars()
        .first()
    )
    if ticket is not None:
        return connection_service.resolve_work_item_for_ticket(db, ticket)
    if comment.provider_kind:
        conn = connection_service.first_of_kind(db, comment.provider_kind)
        if conn is not None:
            return conn
    raise ProviderError(
        f"Work-item provider for '{comment.ticket_external_id}' is not configured"
    )


def _build_adapter(db: Session, comment: TicketComment):
    """Resolve the comment's connection, decrypt secrets, and build a live adapter."""
    connection = _resolve_connection(db, comment)
    decrypted_secrets = {k: crypto.decrypt(v) for k, v in (connection.secrets or {}).items()}
    return get_adapter(connection.kind, connection.config or {}, decrypted_secrets)


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
        adapter = _build_adapter(db, comment)
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
        audit_service.record(
            category="comment", actor_type="ai", action="Posted results comment",
            target=comment.ticket_external_id, status="error", meta=comment.error_message,
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
    audit_service.record(
        category="comment", actor_type="ai", action="Posted results comment",
        target=comment.ticket_external_id, meta="Comment published",
    )
    return comment
