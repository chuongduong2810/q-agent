"""Ticket comment model — prepared + published results back to the provider."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, timestamp_column

PUBLISH_STATUSES = ("draft", "publishing", "published", "failed")


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    ticket_external_id: Mapped[str] = mapped_column(String(64), index=True)
    provider_kind: Mapped[str] = mapped_column(String(16))

    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    target_status: Mapped[str] = mapped_column(String(48), default="")  # status mapping applied
    external_comment_id: Mapped[str] = mapped_column(String(64), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list] = mapped_column(JSON, default=list)  # evidence file refs

    created_at: Mapped[datetime] = timestamp_column()
