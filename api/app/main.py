"""FastAPI application factory and entrypoint."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from app.config import settings
from app.db import init_db
from app.logging import logger, setup_logging
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


def _seed_admin() -> None:
    """Create a seed admin from QAGENT_ADMIN_EMAIL/PASSWORD when no user exists."""
    if not (settings.admin_email and settings.admin_password):
        return
    from app.db import SessionLocal
    from app.models.user import ROLE_ADMIN, User

    db = SessionLocal()
    try:
        if db.query(User.id).first() is not None:
            return
        email = settings.admin_email.strip().lower()
        db.add(
            User(
                email=email,
                first_name="Admin",
                last_name="",
                role=ROLE_ADMIN,
                password_hash=auth_service.hash_password(settings.admin_password),
                is_active=True,
            )
        )
        db.commit()
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
        # Static artifacts bypass router deps → validate a ?token= access token.
        if path.startswith("/artifacts"):
            if auth_service.access_token_valid(request.query_params.get("token")):
                return await call_next(request)
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
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

    # Feature routers (implemented by feature modules).
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(ai.router)
    app.include_router(audit.router)
    app.include_router(providers.router)
    app.include_router(projects.router)
    app.include_router(tickets.router)
    app.include_router(runs.router)
    app.include_router(review.router)
    app.include_router(automation.router)
    app.include_router(execution.router)
    app.include_router(evidence.router)
    app.include_router(reports.router)
    app.include_router(comments.router)

    # Serve captured evidence artifacts statically.
    app.mount(
        "/artifacts",
        StaticFiles(directory=str(settings.evidence_dir), check_dir=False),
        name="artifacts",
    )

    @app.websocket("/ws/runs/{run_id}")
    async def run_progress(websocket: WebSocket, run_id: str) -> None:
        # WS bypasses the HTTP guard → validate ?token= when auth is required.
        if settings.auth_required and not auth_service.access_token_valid(
            websocket.query_params.get("token")
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
