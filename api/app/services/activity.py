"""AI activity tracker — observability for Claude CLI invocations.

Every Claude CLI call is registered here so operators can see, in real time,
that the CLI is actually running (and for how long) rather than silently
hanging. Each call is logged via Loguru and broadcast over the ``ai`` WebSocket
topic; a snapshot is exposed at ``GET /ai/activity``.
"""

from __future__ import annotations

import itertools
import threading
import time
from collections import deque
from typing import Any

from app.db import utcnow
from app.logging import logger
from app.ws import hub

AI_TOPIC = "ai"

_counter = itertools.count(1)
_lock = threading.Lock()
_recent: deque[dict[str, Any]] = deque(maxlen=50)
_running: dict[int, dict[str, Any]] = {}


def start(label: str, skill: str | None = None) -> int:
    """Record the start of a Claude CLI call. Returns a call id for :func:`finish`."""
    call_id = next(_counter)
    rec = {
        "id": call_id,
        "label": label,
        "skill": skill,
        "status": "running",
        "startedAt": utcnow().isoformat(),
        "_t0": time.monotonic(),
    }
    with _lock:
        _running[call_id] = rec
    logger.info("Claude CLI ▶ {}{}", label, f"  [{skill}]" if skill else "")
    hub.publish(AI_TOPIC, "ai.start", {"id": call_id, "label": label, "skill": skill})
    return call_id


def finish(call_id: int, ok: bool = True, error: str = "") -> None:
    """Record completion (success or failure) of a Claude CLI call."""
    with _lock:
        rec = _running.pop(call_id, None)
    if not rec:
        return
    duration_ms = int((time.monotonic() - rec["_t0"]) * 1000)
    rec.update(status="ok" if ok else "error", durationMs=duration_ms, error=error or "")
    rec.pop("_t0", None)
    with _lock:
        _recent.appendleft(rec)
    logger.info(
        "Claude CLI {} {} in {:.1f}s{}",
        "✓" if ok else "✗",
        rec["label"],
        duration_ms / 1000,
        "" if ok else f"  — {error[:120]}",
    )
    hub.publish(
        AI_TOPIC,
        "ai.end",
        {"id": call_id, "label": rec["label"], "status": rec["status"], "durationMs": duration_ms, "error": error or ""},
    )


def snapshot() -> dict[str, Any]:
    """Current running calls + recent history (most recent first)."""
    with _lock:
        running = [{k: v for k, v in r.items() if k != "_t0"} for r in _running.values()]
        recent = list(_recent)
    return {"running": running, "recent": recent}
