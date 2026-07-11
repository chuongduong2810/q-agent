"""Standalone Local-Agent manual-login capture jobs.

In Local Agent mode the "Capture login now" browser can't open on the (headless)
server — it must open on the operator's OWN machine. This module queues a
capture request that the paired agent claims (``POST /agent/auth/next``), runs a
headed login capture locally, saving the session on THAT machine (never
uploaded), and reports back (``POST /agent/auth/{id}/complete``).

The queue is in-memory: a capture is a transient, seconds-to-minutes request,
and if the server restarts mid-capture the operator simply clicks again. The
persistent "captured at" marker (so the UI can show it across restarts) lives in
the project config's ``extra`` — see ``routers/agent.complete_auth_capture``.
"""

from __future__ import annotations

import itertools
import threading
from urllib.parse import urlsplit

_lock = threading.Lock()
_seq = itertools.count(1)

# Each capture: {id, owner_id, project_key, base_url, origin, status}
# status ∈ {"queued", "running"}. Done/failed captures are removed.
_pending: list[dict] = []


def origin_of(base_url: str) -> str:
    """Scheme+host origin for a base URL (what the agent keys its session on)."""
    parts = urlsplit(base_url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


def request_capture(owner_id: int | None, project_key: str, base_url: str) -> dict:
    """Queue a capture for ``owner_id``'s project (deduped: an in-flight one for
    the same owner+project is returned as-is). Returns the capture dict."""
    with _lock:
        for c in _pending:
            if c["owner_id"] == owner_id and c["project_key"] == project_key:
                return dict(c)
        capture = {
            "id": next(_seq),
            "owner_id": owner_id,
            "project_key": project_key,
            "base_url": base_url,
            "origin": origin_of(base_url),
            "status": "queued",
        }
        _pending.append(capture)
        return dict(capture)


def claim_next(owner_id: int | None) -> dict | None:
    """Atomically claim the oldest queued capture for ``owner_id`` (marks it
    running), or None when nothing is queued."""
    with _lock:
        for c in _pending:
            if c["owner_id"] == owner_id and c["status"] == "queued":
                c["status"] = "running"
                return dict(c)
    return None


def finish(capture_id: int, owner_id: int | None) -> dict | None:
    """Remove + return the capture ``capture_id`` (scoped to ``owner_id``), or
    None if it's unknown/not owned."""
    with _lock:
        for c in _pending:
            if c["id"] == capture_id and c["owner_id"] == owner_id:
                _pending.remove(c)
                return dict(c)
    return None


def is_capturing(owner_id: int | None, project_key: str) -> bool:
    """True while a capture for this owner+project is queued or running."""
    with _lock:
        return any(
            c["owner_id"] == owner_id and c["project_key"] == project_key for c in _pending
        )
