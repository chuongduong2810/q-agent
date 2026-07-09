"""AI activity + Claude credentials management (#95)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps_auth import current_user, require_role
from app.models.user import User
from app.schemas import (
    ClaudeCredentialsStatusOut,
    ClaudeCredentialsUpload,
    OkResponse,
)
from app.services import activity, ai_usage_service, claude_usage_reader
from app.services.claude_credentials import ClaudeCredentialsError, delete_own, delete_shared
from app.services.claude_credentials import status_for as credentials_status_for
from app.services.claude_credentials import upsert_own, upsert_shared

router = APIRouter(tags=["ai"])


@router.get("/ai/activity")
def ai_activity() -> dict:
    """Currently-running + recent Claude CLI calls (see also WS /ws/ai)."""
    return activity.snapshot()


@router.get("/ai/stats")
def ai_stats(refresh: bool = False, user: User | None = Depends(current_user)) -> dict:
    """Real Claude usage read from the local Claude Code session logs (like /usage).

    ``refresh=true`` (manual reload) bypasses the in-process caches and kicks off
    a fresh CLI `/usage` read for the plan-limit %. The machine-wide reading is
    unchanged; ``own`` (#95) additively reports the signed-in user's own
    DB-recorded cost/tokens (scoped via ``owned()``), independent of which
    machine/config-dir the CLI actually ran under.
    """
    base = claude_usage_reader.read_stats(force=refresh)
    own = ai_usage_service.stats(user)
    return {
        **base,
        "own": {
            "costMonth": own["costMonth"],
            "weekTokens": own["weekTokens"],
            "weekBudget": own["weekBudget"],
        },
    }


# ------------------------------------------------------------- credentials
@router.get("/ai/credentials", response_model=ClaudeCredentialsStatusOut)
def get_credentials_status(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> ClaudeCredentialsStatusOut:
    """Whether own/shared Claude credentials are configured, and the effective mode.

    Never returns the token itself — see :func:`app.services.claude_credentials.status_for`.
    """
    owner_id = user.id if user is not None else None
    return ClaudeCredentialsStatusOut.model_validate(credentials_status_for(db, owner_id))


@router.put("/ai/credentials", response_model=OkResponse)
def upload_own_credentials(
    body: ClaudeCredentialsUpload,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> OkResponse:
    """Upload/replace the signed-in user's own Claude CLI credentials.

    ``body.credentials`` must be the raw contents of a Claude CLI
    ``.credentials.json`` file. Requires an authenticated user (own credentials
    have no meaning without one) — errors 401 when auth is required and no user
    is resolved, matching the rest of the per-user (#91) surfaces.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        upsert_own(db, user.id, body.credentials, body.label or "")
    except ClaudeCredentialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return OkResponse()


@router.delete("/ai/credentials", response_model=OkResponse)
def delete_own_credentials(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> OkResponse:
    """Delete the signed-in user's own credential (falls back to shared, if any)."""
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    delete_own(db, user.id)
    return OkResponse()


@router.put("/ai/credentials/shared", response_model=OkResponse)
def upload_shared_credentials(
    body: ClaudeCredentialsUpload,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role("admin")),
) -> OkResponse:
    """Admin-only: upload/replace the shared/fallback Claude CLI credentials."""
    try:
        upsert_shared(db, body.credentials, body.label or "")
    except ClaudeCredentialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return OkResponse()


@router.delete("/ai/credentials/shared", response_model=OkResponse)
def delete_shared_credentials(
    db: Session = Depends(get_db), _admin: User = Depends(require_role("admin"))
) -> OkResponse:
    """Admin-only: delete the shared/fallback Claude CLI credentials."""
    delete_shared(db)
    return OkResponse()
