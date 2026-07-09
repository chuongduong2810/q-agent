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
from app.deps_auth import current_user
from app.models.comment import TicketComment
from app.models.report import Report
from app.models.run import Run
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas import CommentEdit, PublishRequest, TicketCommentOut
from app.services import claude_cli
from app.services.claude_cli import ClaudeError
from app.services.ownership import get_owned_or_404
from app.services.publish_service import publish_one
from app.services.report_service import build_report
from app.services.run_status import set_run_status
from app.services.skills import TICKET_COMMENT_GENERATOR

router = APIRouter(tags=["comments"])


def _maybe_finish_run(db: Session, run_id: int) -> None:
    """Close the ADR 0005 'done' gap: once every comment for the run has
    reached a terminal outcome (published or failed), the pipeline — whose
    last stage is publishing results comments — has reached its natural end.
    """
    run = db.get(Run, run_id)
    if run is None:
        return
    comments = db.execute(
        select(TicketComment).where(TicketComment.run_id == run_id)
    ).scalars().all()
    if comments and all(c.status in ("published", "failed") for c in comments):
        set_run_status(db, run, "done")

# Status mapping applied to the provider work item once a comment is published.
# All cases passing -> "Passed"; any failure -> "QA Failed".
_TARGET_STATUS_ALL_PASS = "Passed"
_TARGET_STATUS_ANY_FAIL = "QA Failed"


def _latest_report(db: Session, run_id: int) -> Report:
    """Latest report for the run, building one on demand if none exists yet.

    Preparing comments shouldn't dead-end the user: the report is derived from the
    run's latest execution, so if they came straight from Evidence without building
    a report first, we build it here rather than 404'ing.
    """
    stmt = select(Report).where(Report.run_id == run_id).order_by(Report.id.desc()).limit(1)
    report = db.execute(stmt).scalars().first()
    if report is None:
        report = build_report(db, run_id)
    return report


def _summarize_ticket(ticket_external_id: str, summary: dict, ai_failure_analysis: str) -> str:
    """Ask Claude for ONE consolidated QA comment aggregating all of a ticket's
    test cases — overall verdict, per-case breakdown, and consolidated findings.

    The ticket is only "Passed" when every case passed; any failure means the
    ticket failed. Raises ClaudeError to the caller (ADR 0001 — no simulated
    fallback); the router surfaces it as an HTTP error.
    """
    passed, failed, total = summary["passed"], summary["failed"], summary["total"]
    case_lines = []
    for c in summary.get("cases", []):
        status = c.get("status", "")
        mark = "PASS" if status == "pass" else "FAIL" if status == "fail" else status.upper()
        detail = ""
        if status == "fail":
            detail = " — " + (c.get("diagnosis") or c.get("error") or "failed").strip()
        case_lines.append(f"- {c.get('caseCode', '')} {c.get('title', '')}: {mark}{detail}")
    cases_block = "\n".join(case_lines) or "- (no test cases executed)"

    prompt = (
        f"Write ONE consolidated QA result comment to post on ticket {ticket_external_id}. "
        "It must summarize the OVERALL outcome across ALL of the ticket's executed test "
        "cases — the ticket is 'Passed' only if every case passed; any failure means the "
        f"ticket failed. Overall: {passed}/{total} cases passed, {failed} failed.\n\n"
        f"Per test case:\n{cases_block}\n\n"
        + (f"Cross-case failure analysis: {ai_failure_analysis}\n\n" if failed and ai_failure_analysis else "")
        + "Structure the comment as: (1) a one-line overall verdict, (2) a short per-case "
        "breakdown, and (3) consolidated key findings for any failures (fold in each failing "
        "case's diagnosis). Do not include a greeting or signature."
    )
    return claude_cli.run_prompt(
        prompt,
        skill=TICKET_COMMENT_GENERATOR,
        include_template=True,
        label=f"Comment: {ticket_external_id}",
    ).strip()


@router.post("/runs/{run_id}/comments/prepare", response_model=list[TicketCommentOut])
def prepare_comments(
    run_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[TicketComment]:
    get_owned_or_404(db, Run, run_id, user)
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
        # Passed only when every approved case's script ran and passed (ticket
        # status from the report); fall back to the failed-count for old reports.
        ticket_status = summary.get("status") or (
            "Passed" if summary["failed"] == 0 else "Failed"
        )
        target_status = (
            _TARGET_STATUS_ALL_PASS if ticket_status == "Passed" else _TARGET_STATUS_ANY_FAIL
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

    run = db.get(Run, run_id)
    if run is not None:
        set_run_status(db, run, "comment")

    return comments


@router.get("/runs/{run_id}/comments", response_model=list[TicketCommentOut])
def list_comments(
    run_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[TicketComment]:
    get_owned_or_404(db, Run, run_id, user)
    stmt = select(TicketComment).where(TicketComment.run_id == run_id).order_by(TicketComment.id)
    return list(db.execute(stmt).scalars())


def _get_comment_or_404(db: Session, comment_id: int, user: User | None) -> TicketComment:
    """Resolve a comment, 404ing if missing or if its run isn't owned by ``user``."""
    comment = db.get(TicketComment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    get_owned_or_404(db, Run, comment.run_id, user)
    return comment


@router.patch("/comments/{comment_id}", response_model=TicketCommentOut)
def edit_comment(
    comment_id: int,
    body: CommentEdit,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> TicketComment:
    comment = _get_comment_or_404(db, comment_id, user)
    if body.body is not None:
        comment.body = body.body
    if body.target_status is not None:
        comment.target_status = body.target_status
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.post("/comments/{comment_id}/publish", response_model=TicketCommentOut)
def publish_comment(
    comment_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> TicketComment:
    comment = _get_comment_or_404(db, comment_id, user)
    result = publish_one(db, comment)
    _maybe_finish_run(db, comment.run_id)
    return result


@router.post("/runs/{run_id}/comments/publish", response_model=list[TicketCommentOut])
def publish_comments(
    run_id: int,
    body: PublishRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> list[TicketComment]:
    get_owned_or_404(db, Run, run_id, user)
    stmt = select(TicketComment).where(TicketComment.run_id == run_id)
    if body.ticket_ids:
        stmt = stmt.where(TicketComment.ticket_external_id.in_(body.ticket_ids))
    comments = list(db.execute(stmt).scalars())
    results = [publish_one(db, c) for c in comments]
    _maybe_finish_run(db, run_id)
    return results


@router.post("/runs/{run_id}/comments/retry", response_model=list[TicketCommentOut])
def retry_comments(
    run_id: int, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[TicketComment]:
    get_owned_or_404(db, Run, run_id, user)
    stmt = select(TicketComment).where(
        TicketComment.run_id == run_id, TicketComment.status == "failed"
    )
    comments = list(db.execute(stmt).scalars())
    results = [publish_one(db, c) for c in comments]
    _maybe_finish_run(db, run_id)
    return results
