"""WebSocket connection manager for real-time pipeline / execution progress.

Clients subscribe per Run (``/ws/runs/{run_id}``). Backend services publish
progress events (analysis phases, generation, execution status, publish status)
which are fanned out to every subscriber of that run.

Because backend work runs in threads (subprocess calls to Claude CLI / Playwright)
while FastAPI's event loop lives elsewhere, publishing is thread-safe: it hops
onto the stored event loop via ``run_coroutine_threadsafe``.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.logging import logger


class ProgressHub:
    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None
        # Most recent event per run, so a client that connects mid-run is caught
        # up immediately (see connect). Events are fire-and-forget: on a fresh run
        # the pipeline thread publishes the early phase events before the client's
        # socket finishes connecting, and without this replay they're lost — the
        # run detail then looks frozen until the next event fires. Set synchronously
        # in publish (not on the event loop) so there is no connect/publish race.
        self._last: dict[str, dict[str, Any]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, run_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._conns[run_id].add(ws)
        logger.debug("WS connected run={} (total={})", run_id, len(self._conns[run_id]))
        # Replay the last event so a client joining mid-run (or after a reload)
        # renders the current phase without waiting for the next event.
        last = self._last.get(run_id)
        if last is not None:
            try:
                await ws.send_json(last)
            except Exception:  # noqa: BLE001 - client gone before first send
                self.disconnect(run_id, ws)

    def disconnect(self, run_id: str, ws: WebSocket) -> None:
        self._conns[run_id].discard(ws)

    async def _broadcast(self, run_id: str, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._conns.get(run_id, ())):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - client gone
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)

    def publish(self, run_id: str, event: str, payload: dict[str, Any] | None = None) -> None:
        """Thread-safe publish of a progress event to a run's subscribers."""
        message = {"event": event, "runId": run_id, "payload": payload or {}}
        # Cache before scheduling the broadcast so a client connecting between now
        # and the broadcast still gets caught up via connect's replay.
        self._last[run_id] = message
        if self._loop is None or self._loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(run_id, message), self._loop)
        except RuntimeError:
            logger.warning("WS publish dropped (no running loop) run={} event={}", run_id, event)


hub = ProgressHub()
