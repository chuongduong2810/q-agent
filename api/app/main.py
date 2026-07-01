"""FastAPI application factory and entrypoint."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import init_db
from app.logging import logger, setup_logging
from app.routers import (
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
from app.ws import hub


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    setup_logging()
    settings.ensure_dirs()
    init_db()
    hub.bind_loop(asyncio.get_running_loop())
    logger.info("Q-Agent API ready on {}:{}", settings.host, settings.port)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Q-Agent API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Feature routers (implemented by feature modules).
    app.include_router(health.router)
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
        await hub.connect(run_id, websocket)
        try:
            while True:
                # We only push server→client; keep the socket alive.
                await websocket.receive_text()
        except WebSocketDisconnect:
            hub.disconnect(run_id, websocket)

    return app


app = create_app()
