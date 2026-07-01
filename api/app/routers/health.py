"""Health + capability probe endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app import __version__
from app.services import claude_cli

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@router.get("/capabilities")
def capabilities() -> dict:
    """Report which local engines are available (Claude CLI, Playwright)."""
    return {
        "claude": claude_cli.is_available(),
        "version": __version__,
    }
