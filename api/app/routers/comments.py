"""Ticket comments / publish router.

Endpoints to implement:
  POST  /runs/{run_id}/comments/prepare   -> list[TicketCommentOut]   (draft from report; Claude summarizes)
  GET   /runs/{run_id}/comments           -> list[TicketCommentOut]
  PATCH /comments/{comment_id}            -> TicketCommentOut          (CommentEdit)
  POST  /comments/{comment_id}/publish    -> TicketCommentOut          (publish one via adapter)
  POST  /runs/{run_id}/comments/publish   -> list[TicketCommentOut]    (PublishRequest; publish all/selected)
  POST  /runs/{run_id}/comments/retry     -> list[TicketCommentOut]    (retry failed)
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["comments"])
