"""Local Agent router — device pairing + the job-claim/push protocol.

Two endpoint groups (Local Agent feature — see the implementation plan):

**Device management** (``require_user`` — an already-authenticated SPA user):
  POST   /agent/devices/pair-code   -> {code, expiresIn}
  GET    /agent/devices             -> [{id, name, lastSeenAt, createdAt}]
  DELETE /agent/devices/{id}        -> {ok}
  POST   /agent/devices/redeem      -> {deviceToken, deviceId}  (auth is the
                                        pairing code itself, not a user token —
                                        this is what the Node CLI calls)

**Job protocol** (``require_agent`` — a paired device's bearer token; every
handler scopes to the device's owning user via ``get_owned_or_404``):
  POST /agent/jobs/next               -> job payload, or 204 if nothing queued
  POST /agent/jobs/{id}/events        -> re-emit {event, payload} onto the run's WS
  POST /agent/jobs/{id}/results       -> upsert one parsed ExecutionResult
  POST /agent/jobs/{id}/evidence      -> multipart artifact upload
  POST /agent/jobs/{id}/complete      -> finalize {passed, failed, log}

The ``/agent/jobs/next`` payload NEVER includes storageState/sessionStorage or
any other captured session — auth is handled locally by the agent (manual
login happens on the user's own machine); the server only tells it whether
manual auth is required and which origin(s) to expect it for.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps_auth import require_agent, require_user
from app.models.execution import Execution, ExecutionResult
from app.models.run import Run
from app.models.testcase import AutomationSpec
from app.models.user import User
from app.services import agent_device_service, evidence_service, execution_service, settings_store, spec_service
from app.services.auth_service import AuthError
from app.services.ownership import get_owned_or_404
from app.services.playwright_runner import _resolve_project_for_run
from app.ws import hub

router = APIRouter(prefix="/agent", tags=["agent"])


# --------------------------------------------------------------- device management
@router.post("/devices/pair-code")
def create_pair_code(user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    """Issue a short-lived pairing code for the current user to give to their agent."""
    code = agent_device_service.create_pairing_code(db, user)
    return {"code": code, "expiresIn": int(agent_device_service.PAIR_TTL.total_seconds())}


@router.get("/devices")
def list_devices(user: User = Depends(require_user), db: Session = Depends(get_db)) -> list[dict]:
    """List the current user's paired (non-revoked) Local Agent devices."""
    return [
        {
            "id": d.id,
            "name": d.name,
            "lastSeenAt": d.last_seen_at,
            "createdAt": d.created_at,
        }
        for d in agent_device_service.list_devices(db, user)
    ]


@router.delete("/devices/{device_id}")
def revoke_device(
    device_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)
) -> dict:
    """Revoke a paired device."""
    device = agent_device_service.revoke(db, user, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"ok": True}


@router.post("/devices/redeem")
def redeem_device(body: dict, db: Session = Depends(get_db)) -> dict:
    """Redeem a pairing code (called by the Local Agent CLI, not the SPA).

    Body: ``{"code": str, "name": str}``. Auth is the pairing code itself — no
    user bearer token is involved here.
    """
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    try:
        device, token = agent_device_service.redeem_pairing_code(db, code, body.get("name", ""))
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"deviceToken": token, "deviceId": device.id}


# --------------------------------------------------------------------- job protocol
def _owned_execution(db: Session, execution_id: int, user: User) -> tuple[Execution, Run]:
    """Fetch an Execution + its Run, 404ing unless the run belongs to ``user``."""
    execution = db.get(Execution, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")
    run = get_owned_or_404(db, Run, execution.run_id, user)
    return execution, run


@router.post("/jobs/next")
def claim_next_job(
    response: Response, user: User = Depends(require_agent), db: Session = Depends(get_db)
) -> dict | None:
    """Atomically claim the oldest queued local-agent Execution owned by this user.

    Uses a conditional UPDATE (``WHERE status='queued'``) so a concurrent claim
    from another poll can never double-claim the same row: only one caller's
    UPDATE affects a row. Returns 204 (empty) when nothing is queued.
    """
    candidate = (
        db.query(Execution.id)
        .join(Run, Execution.run_id == Run.id)
        .filter(
            Execution.status == "queued",
            Execution.target == "local-agent",
            Run.owner_id == user.id,
        )
        .order_by(Execution.id)
        .first()
    )
    if candidate is None:
        response.status_code = 204
        return None
    execution_id = candidate[0]
    device = getattr(user, "_device", None)
    result = db.execute(
        update(Execution)
        .where(Execution.id == execution_id, Execution.status == "queued")
        .values(
            status="running",
            claimed_by_device_id=device.id if device else None,
            started_at=datetime.now(timezone.utc),
        )
    )
    db.commit()
    if result.rowcount == 0:
        # Lost the race to another poll between the select and the update.
        response.status_code = 204
        return None

    execution = db.get(Execution, execution_id)
    run = db.get(Run, execution.run_id)
    results = (
        db.query(ExecutionResult)
        .filter(ExecutionResult.execution_id == execution.id)
        .order_by(ExecutionResult.id)
        .all()
    )
    _project_key, base_url, manual_auth, _provider = _resolve_project_for_run(db, run, execution.env)
    auth_origins: list[str] = []
    if base_url:
        parts = urlsplit(base_url)
        if parts.scheme and parts.netloc:
            auth_origins = [f"{parts.scheme}://{parts.netloc}"]

    specs: list[dict] = []
    for r in results:
        spec = (
            db.query(AutomationSpec)
            .filter(AutomationSpec.test_case_id == r.test_case_id)
            .first()
        )
        if spec is None:
            continue
        specs.append(
            {
                "filename": spec_service.spec_filename(r.ticket_external_id, r.case_code),
                "code": spec.code,
                # Explicit identity so the agent can match /jobs/{id}/evidence by exact
                # ticket_external_id (the filename convention drops the provider prefix,
                # e.g. "SUR-1428" -> "1428", which would 404 the evidence upload).
                "ticketExternalId": r.ticket_external_id,
                "caseCode": r.case_code,
            }
        )

    return {
        "executionId": execution.id,
        "runCode": run.code,
        "env": execution.env,
        "browser": execution.browser,
        "workers": execution.workers,
        "headless": bool(settings_store.load_settings().get("headless", True)),
        "baseUrl": base_url,
        "manualAuth": manual_auth,
        "authOrigins": auth_origins,
        "specs": specs,
    }


@router.post("/jobs/{execution_id}/events")
def push_job_event(
    execution_id: int, body: dict, user: User = Depends(require_agent), db: Session = Depends(get_db)
) -> dict:
    """Re-emit an agent-reported progress event onto the run's WS channel.

    Body: ``{"event": str, "payload": dict}``. This is how the SPA's existing
    ``/ws/runs/{id}`` subscribers (unchanged) see ``exec.case.running`` /
    ``exec.case.result`` / ``exec.progress`` / ``exec.auth.waiting`` etc. from a
    Local Agent run.
    """
    execution, _run = _owned_execution(db, execution_id, user)
    event = body.get("event")
    if not event:
        raise HTTPException(status_code=400, detail="event is required")
    hub.publish(str(execution.run_id), event, body.get("payload") or {})
    return {"ok": True}


@router.post("/jobs/{execution_id}/results")
def push_job_result(
    execution_id: int, body: dict, user: User = Depends(require_agent), db: Session = Depends(get_db)
) -> dict:
    """Upsert one parsed result, shaped exactly like ``parse_playwright_report``'s
    output (``file``/``filename``, ``status``, ``duration_ms``, ``error_message``).
    Matched to its ExecutionResult by the spec filename convention (shared with
    the server runner via ``execution_service.match_result``).
    """
    execution, _run = _owned_execution(db, execution_id, user)
    results = (
        db.query(ExecutionResult)
        .filter(ExecutionResult.execution_id == execution.id)
        .order_by(ExecutionResult.id)
        .all()
    )
    result = execution_service.apply_result(db, results, body)
    if result is None:
        raise HTTPException(status_code=400, detail="No matching result for this file")
    return {"ok": True, "resultId": result.id}


@router.post("/jobs/{execution_id}/evidence")
async def push_job_evidence(
    execution_id: int,
    ticket_external_id: str = Form(...),
    case_code: str = Form(...),
    kind: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(require_agent),
    db: Session = Depends(get_db),
) -> dict:
    """Upload one evidence artifact (multipart) for a case's result."""
    execution, run = _owned_execution(db, execution_id, user)
    result = (
        db.query(ExecutionResult)
        .filter(
            ExecutionResult.execution_id == execution.id,
            ExecutionResult.ticket_external_id == ticket_external_id,
            ExecutionResult.case_code == case_code,
        )
        .first()
    )
    if result is None:
        raise HTTPException(status_code=404, detail="No matching result for this ticket/case")
    content = await file.read()
    evidence = evidence_service.store_uploaded_evidence(
        db, run, result, kind, content, file.filename or "evidence"
    )
    if evidence is None:
        raise HTTPException(status_code=400, detail="Failed to store evidence")
    db.commit()
    return {"id": evidence.id, "kind": evidence.kind, "filename": evidence.filename}


@router.post("/jobs/{execution_id}/complete")
def complete_job(
    execution_id: int, body: dict, user: User = Depends(require_agent), db: Session = Depends(get_db)
) -> dict:
    """Finalize an agent-run Execution. Body: ``{"passed": int, "failed": int, "log": str}``."""
    execution, run = _owned_execution(db, execution_id, user)
    execution.passed = int(body.get("passed") or 0)
    execution.failed = int(body.get("failed") or 0)
    execution_service.finalize(db, execution, run, body.get("log", ""))
    return {"ok": True}
