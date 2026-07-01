"""Ticket comments / publish router.

Endpoints:
  POST  /runs/{run_id}/comments/prepare   -> list[TicketCommentOut]   (draft from report; Claude summarizes)
  GET   /runs/{run_id}/comments           -> list[TicketCommentOut]
  PATCH /comments/{comment_id}            -> TicketCommentOut          (CommentEdit)
  POST  /comments/{comment_id}/publish    -> TicketCommentOut          (publish one via adapter)
  POST  /runs/{run_id}/comments/publish   -> list[TicketCommentOut]    (PublishRequest; publish all/selected)
  POST  /runs/{run_id}/comments/retry     -> list[TicketCommentOut]    (retry failed)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.comment import TicketComment
from app.models.report import Report
from app.models.ticket import Ticket
from app.schemas import CommentEdit, PublishRequest, TicketCommentOut
from app.services import claude_cli
from app.services.claude_cli import ClaudeError
from app.services.publish_service import publish_one

router = APIRouter(tags=["comments"])

# Status mapping applied to the provider work item once a comment is published.
# All cases passing -> "Passed"; any failure -> "QA Failed".
_TARGET_STATUS_ALL_PASS = "Passed"
_TARGET_STATUS_ANY_FAIL = "QA Failed"


def _latest_report(db: Session, run_id: int) -> Report:
    stmt = select(Report).where(Report.run_id == run_id).order_by(Report.id.desc()).limit(1)
    report = db.execute(stmt).scalars().first()
    if report is None:
        raise HTTPException(status_code=404, detail="No report for this run; generate one first")
    return report


def _summarize_ticket(ticket_external_id: str, summary: dict, ai_failure_analysis: str) -> str:
    """Ask Claude to write a QA result comment body for one ticket's summary.

    Falls back to raising ClaudeError to the caller — there is no simulated
    fallback (ADR 0001); the router surfaces the failure as an HTTP error.
    """
    passed, failed, total = summary["passed"], summary["failed"], summary["total"]
    prompt = (
        "Write a concise, professional QA result comment to post on a ticket "
        f"({ticket_external_id}). Results: {passed}/{total} test cases passed, "
        f"{failed} failed. "
        + (f"Failure analysis context: {ai_failure_analysis}\n" if failed and ai_failure_analysis else "")
        + "Use short paragraphs or a small bullet list. Do not include a greeting or signature."
    )
    return claude_cli.run_prompt(prompt).strip()


@router.post("/runs/{run_id}/comments/prepare", response_model=list[TicketCommentOut])
def prepare_comments(run_id: int, db: Session = Depends(get_db)) -> list[TicketComment]:
    report = _latest_report(db, run_id)
    ticket_summaries = report.data.get("ticketSummary", [])
    ai_failure_analysis = report.data.get("aiFailureAnalysis", "")

    tickets = {
        t.external_id: t
        for t in db.execute(
            select(Ticket).where(
                Ticket.external_id.in_([s["ticketExternalId"] for s in ticket_summaries])
            )
        ).scalars()
    }

    comments: list[TicketComment] = []
    for summary in ticket_summaries:
        ticket_external_id = summary["ticketExternalId"]
        ticket = tickets.get(ticket_external_id)
        provider_kind = ticket.provider_kind if ticket else ""
        target_status = (
            _TARGET_STATUS_ALL_PASS if summary["failed"] == 0 else _TARGET_STATUS_ANY_FAIL
        )
        try:
            body = _summarize_ticket(ticket_external_id, summary, ai_failure_analysis)
        except ClaudeError as exc:
            raise HTTPException(status_code=502, detail=f"Claude CLI failed: {exc}") from exc

        existing = db.execute(
            select(TicketComment).where(
                TicketComment.run_id == run_id,
                TicketComment.ticket_external_id == ticket_external_id,
            )
        ).scalars().first()
        if existing is not None:
            existing.body = body
            existing.target_status = target_status
            existing.status = "draft"
            existing.error_message = ""
            comment = existing
        else:
            comment = TicketComment(
                run_id=run_id,
                ticket_external_id=ticket_external_id,
                provider_kind=provider_kind,
                body=body,
                status="draft",
                target_status=target_status,
            )
        db.add(comment)
        comments.append(comment)

    db.commit()
    for c in comments:
        db.refresh(c)
    return comments


@router.get("/runs/{run_id}/comments", response_model=list[TicketCommentOut])
def list_comments(run_id: int, db: Session = Depends(get_db)) -> list[TicketComment]:
    stmt = select(TicketComment).where(TicketComment.run_id == run_id).order_by(TicketComment.id)
    return list(db.execute(stmt).scalars())


def _get_comment_or_404(db: Session, comment_id: int) -> TicketComment:
    comment = db.get(TicketComment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.patch("/comments/{comment_id}", response_model=TicketCommentOut)
def edit_comment(comment_id: int, body: CommentEdit, db: Session = Depends(get_db)) -> TicketComment:
    comment = _get_comment_or_404(db, comment_id)
    if body.body is not None:
        comment.body = body.body
    if body.target_status is not None:
        comment.target_status = body.target_status
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.post("/comments/{comment_id}/publish", response_model=TicketCommentOut)
def publish_comment(comment_id: int, db: Session = Depends(get_db)) -> TicketComment:
    comment = _get_comment_or_404(db, comment_id)
    return publish_one(db, comment)


@router.post("/runs/{run_id}/comments/publish", response_model=list[TicketCommentOut])
def publish_comments(
    run_id: int, body: PublishRequest, db: Session = Depends(get_db)
) -> list[TicketComment]:
    stmt = select(TicketComment).where(TicketComment.run_id == run_id)
    if body.ticket_ids:
        stmt = stmt.where(TicketComment.ticket_external_id.in_(body.ticket_ids))
    comments = list(db.execute(stmt).scalars())
    return [publish_one(db, c) for c in comments]


@router.post("/runs/{run_id}/comments/retry", response_model=list[TicketCommentOut])
def retry_comments(run_id: int, db: Session = Depends(get_db)) -> list[TicketComment]:
    stmt = select(TicketComment).where(
        TicketComment.run_id == run_id, TicketComment.status == "failed"
    )
    comments = list(db.execute(stmt).scalars())
    return [publish_one(db, c) for c in comments]
