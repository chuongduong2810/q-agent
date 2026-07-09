"""FastAPI application factory and entrypoint."""

from __future__ import annotations

import asyncio
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from app.config import settings
from app.db import init_db
from app.logging import logger, setup_logging
from app.models.run import Run
from app.services.audit_context import bind_audit_actor
from app.routers import (
    ai,
    audit,
    auth,
    automation,
    comments,
    evidence,
    execution,
    health,
    projects,
    providers,
    reports,
    review,
    runs,
    tickets,
)
from app.services import auth_service
from app.ws import hub

# Paths reachable without a bearer access token when QAGENT_AUTH_REQUIRED is on.
_AUTH_ALLOWLIST = {
    "/health",
    "/auth/login",
    "/auth/login/mfa",
    "/auth/refresh",
    "/auth/request-reset",
    "/auth/reset",
    "/openapi.json",
    "/docs",
    "/redoc",
    "/docs/oauth2-redirect",
}


def _token_user_id(token: str | None) -> int | None:
    """Decode a validated access token and return the user id (``sub`` claim).

    Returns ``None`` when ``token`` is missing/invalid — callers are expected to
    have already validated the token (e.g. via ``access_token_valid``) so this
    should only fail on a decode race; treat it as "no user" defensively.
    """
    if not token:
        return None
    try:
        payload = auth_service.decode_access_token(token)
    except auth_service.AuthError:
        return None
    return int(payload.get("sub", 0) or 0)


def _run_owner_allows(owner_id: int | None, user_id: int) -> bool:
    """A run with no owner (pre-ownership data, #91 bridge) is reachable by
    anyone; an owned run only by its owner."""
    return owner_id is None or owner_id == user_id


def _artifact_access_allowed(path: str, token: str | None) -> bool:
    """True if the token's user may fetch this ``/artifacts/<RUN-CODE>/...`` path.

    Evidence files are stored under ``settings.evidence_dir/<run.code>/...``, so
    the run code is the first path segment after ``/artifacts/``. Looks up the
    run by code and applies the same owner check as
    ``app.services.ownership.get_owned_or_404`` (#92 — run domain scoping).
    """
    user_id = _token_user_id(token)
    if user_id is None:
        return False
    parts = path.split("/", 3)  # ["", "artifacts", "<code>", "..."]
    code = parts[2] if len(parts) > 2 else ""
    if not code:
        return False
    # Local import (like _seed_admin below): re-reads app.db.SessionLocal at call
    # time instead of binding it once at module-import time, so the test suite's
    # per-test engine rebind (see conftest.workspace_dir) is honored.
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        run = db.query(Run).filter(Run.code == code).first()
    finally:
        db.close()
    if run is None:
        return False
    return _run_owner_allows(run.owner_id, user_id)


def _run_ws_access_allowed(run_id: str, token: str | None) -> bool:
    """True if the token's user may subscribe to this run's WS channel (#92).

    ``run_id`` is the numeric ``Run.id`` used by ``/ws/runs/{run_id}``.
    """
    user_id = _token_user_id(token)
    if user_id is None:
        return False
    try:
        rid = int(run_id)
    except ValueError:
        return False
    from app.db import SessionLocal  # see _artifact_access_allowed

    db = SessionLocal()
    try:
        run = db.get(Run, rid)
    finally:
        db.close()
    if run is None:
        return False
    return _run_owner_allows(run.owner_id, user_id)


def _seed_admin() -> None:
    """Ensure a first admin exists so an auth-required install is reachable.

    Precedence: explicit ``QAGENT_ADMIN_EMAIL``/``QAGENT_ADMIN_PASSWORD`` win. In
    dev (``cookie_secure`` off) with auth required and no explicit creds, a
    fallback ``admin@qagent.local`` is seeded with a generated password logged at
    startup — so the operator is never locked out. In prod (``cookie_secure`` on)
    we refuse to seed an insecure default and log how to create the admin.
    """
    from app.db import SessionLocal
    from app.models.user import ROLE_ADMIN, User

    db = SessionLocal()
    try:
        if db.query(User.id).first() is not None:
            return
        dev = not settings.cookie_secure
        fallback_ok = settings.auth_required and dev
        email = (settings.admin_email or ("admin@qagent.local" if fallback_ok else "")).strip().lower()
        password = settings.admin_password
        generated = False
        if not password and fallback_ok:
            password = secrets.token_urlsafe(12)
            generated = True
        if not (email and password):
            if settings.auth_required:
                logger.error(
                    "Auth is required but no admin was seeded — set QAGENT_ADMIN_EMAIL "
                    "and QAGENT_ADMIN_PASSWORD to create the first administrator."
                )
            return
        db.add(
            User(
                email=email,
                first_name="Admin",
                last_name="",
                role=ROLE_ADMIN,
                password_hash=auth_service.hash_password(password),
                is_active=True,
            )
        )
        db.commit()
        if generated:
            logger.warning(
                "Seeded DEV admin {} with a generated password: {}  "
                "(set QAGENT_ADMIN_PASSWORD to choose your own)",
                email,
                password,
            )
        else:
            logger.info("Seeded admin user {}", email)
    except Exception as exc:  # noqa: BLE001 - never block startup on the seed
        logger.warning("admin seed failed: {}", exc)
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    setup_logging()
    settings.ensure_dirs()
    init_db()
    _seed_admin()
    hub.bind_loop(asyncio.get_running_loop())
    logger.info("Q-Agent API ready on {}:{}", settings.host, settings.port)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Q-Agent API", version="0.1.0", lifespan=lifespan)

    # Global auth guard. Registered BEFORE CORS so CORS remains the outermost
    # middleware and its headers are attached even to 401 responses. When
    # QAGENT_AUTH_REQUIRED is off (the local-first default) this is a passthrough.
    @app.middleware("http")
    async def auth_guard(request, call_next):  # noqa: ANN001, ANN202
        if not settings.auth_required:
            return await call_next(request)
        path = request.url.path
        if request.method == "OPTIONS" or path in _AUTH_ALLOWLIST:
            return await call_next(request)
        # Static artifacts bypass router deps → validate a ?token= access token,
        # then (#92) confirm the token's user owns the run the path serves from.
        if path.startswith("/artifacts"):
            token = request.query_params.get("token")
            if not auth_service.access_token_valid(token):
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
            if not _artifact_access_allowed(path, token):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            return await call_next(request)
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            if auth_service.access_token_valid(auth_header[7:].strip()):
                return await call_next(request)
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Allow any localhost port so the Vite dev server works even when it picks
        # an alternate port (5174/5175/…) because the default is taken.
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Feature routers (implemented by feature modules). The bind_audit_actor
    # dependency runs in each endpoint's request context (avoiding the
    # BaseHTTPMiddleware contextvar pitfall) so audit_service.record() attributes
    # events to the authenticated user instead of the "You" default.
    for module in (
        health,
        auth,
        ai,
        audit,
        providers,
        projects,
        tickets,
        runs,
        review,
        automation,
        execution,
        evidence,
        reports,
        comments,
    ):
        app.include_router(module.router, dependencies=[Depends(bind_audit_actor)])

    # Serve captured evidence artifacts statically.
    app.mount(
        "/artifacts",
        StaticFiles(directory=str(settings.evidence_dir), check_dir=False),
        name="artifacts",
    )

    @app.websocket("/ws/runs/{run_id}")
    async def run_progress(websocket: WebSocket, run_id: str) -> None:
        # WS bypasses the HTTP guard → validate ?token=, then (#92) confirm the
        # token's user owns this run, when auth is required.
        if settings.auth_required:
            token = websocket.query_params.get("token")
            if not auth_service.access_token_valid(token) or not _run_ws_access_allowed(
                run_id, token
            ):
                await websocket.close(code=1008)
                return
        await hub.connect(run_id, websocket)
        try:
            while True:
                # We only push server→client; keep the socket alive.
                await websocket.receive_text()
        except WebSocketDisconnect:
            hub.disconnect(run_id, websocket)

    @app.websocket("/ws/ai")
    async def ai_activity_ws(websocket: WebSocket) -> None:
        """Live Claude CLI activity (start/end events) for the UI indicator."""
        if settings.auth_required and not auth_service.access_token_valid(
            websocket.query_params.get("token")
        ):
            await websocket.close(code=1008)
            return
        await hub.connect("ai", websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            hub.disconnect("ai", websocket)

    return app


app = create_app()
