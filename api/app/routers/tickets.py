"""Tickets router.

Endpoints to implement:
  GET  /tickets                     -> list[TicketOut]      (query: status, assignee, sprint, q)
  GET  /tickets/{external_id}        -> TicketDetailOut
  POST /tickets/sync                 -> SyncResult           (body: SyncRequest; live adapter pull)
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/tickets", tags=["tickets"])
