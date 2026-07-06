"""AI activity endpoint — observe Claude CLI invocations."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import activity, ai_usage_service

router = APIRouter(tags=["ai"])


@router.get("/ai/activity")
def ai_activity() -> dict:
    """Currently-running + recent Claude CLI calls (see also WS /ws/ai)."""
    return activity.snapshot()


@router.get("/ai/stats")
def ai_stats() -> dict:
    """Aggregated Claude usage stats (tokens, cost, latency) for the stats panel."""
    return ai_usage_service.stats()
