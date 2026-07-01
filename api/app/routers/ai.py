"""AI activity endpoint — observe Claude CLI invocations."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import activity

router = APIRouter(tags=["ai"])


@router.get("/ai/activity")
def ai_activity() -> dict:
    """Currently-running + recent Claude CLI calls (see also WS /ws/ai)."""
    return activity.snapshot()
