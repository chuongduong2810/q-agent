"""AI activity endpoint — observe Claude CLI invocations."""

from __future__ import annotations

from fastapi import APIRouter

from app.services import activity, claude_usage_reader

router = APIRouter(tags=["ai"])


@router.get("/ai/activity")
def ai_activity() -> dict:
    """Currently-running + recent Claude CLI calls (see also WS /ws/ai)."""
    return activity.snapshot()


@router.get("/ai/stats")
def ai_stats(refresh: bool = False) -> dict:
    """Real Claude usage read from the local Claude Code session logs (like /usage).

    ``refresh=true`` (manual reload) bypasses the in-process caches and kicks off
    a fresh CLI `/usage` read for the plan-limit %.
    """
    return claude_usage_reader.read_stats(force=refresh)
