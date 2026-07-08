"""In-process cooperative-cancellation registry for run worker threads.

See ADR 0005. Keyed by ``run_id``: workers check :func:`is_cancelled` at safe
checkpoints (between tickets/cases) and bail out rather than advancing the
pipeline, leaving whatever terminal status the cancel endpoint already set.
:func:`register_process`/:func:`unregister_process` track live subprocesses
(Playwright) so :func:`kill_processes` can terminate work that's in flight
right now (mid-case cancel), not just stop before the next checkpoint.

Per-process, in-memory registry: on API restart any running threads are
already dead, and the durable ``Run.cancel_requested`` DB column (checked as a
fallback by :func:`is_cancelled`) lets a resumed/retried run behave correctly
even if the in-memory event was lost.
"""

from __future__ import annotations

import threading
from typing import Any

_events: dict[int, threading.Event] = {}
_processes: dict[int, set[Any]] = {}
_lock = threading.Lock()


def request_cancel(run_id: int) -> None:
    """Signal the in-memory cancel event for a run.

    The caller (the cancel endpoint) is also responsible for persisting
    ``Run.cancel_requested`` on the DB row.
    """
    with _lock:
        _events.setdefault(run_id, threading.Event()).set()


def is_cancelled(run_id: int, db: Any = None) -> bool:
    """True if cancel was requested for ``run_id``.

    Checks the in-memory event first; when ``db`` is given, falls back to a
    fresh (non-identity-map) read of ``Run.cancel_requested`` so a worker
    session that loaded the Run row before another session committed the
    cancel still observes it.

    Args:
        run_id: The run to check.
        db: Optional active session for the DB fallback.
    """
    event = _events.get(run_id)
    if event is not None and event.is_set():
        return True
    if db is not None:
        from app.models.run import Run

        flagged = db.query(Run.cancel_requested).filter(Run.id == run_id).scalar()
        if flagged:
            return True
    return False


def register_process(run_id: int, proc: Any) -> None:
    """Track a live subprocess/browser handle for a run so it can be killed."""
    with _lock:
        _processes.setdefault(run_id, set()).add(proc)


def unregister_process(run_id: int, proc: Any) -> None:
    """Stop tracking a subprocess/browser handle (it finished on its own)."""
    with _lock:
        procs = _processes.get(run_id)
        if procs is not None:
            procs.discard(proc)


def kill_processes(run_id: int) -> None:
    """Terminate every tracked subprocess/browser handle for a run.

    Best-effort: a process that's already exited or doesn't support
    kill()/terminate() is ignored rather than raising.
    """
    with _lock:
        procs = _processes.pop(run_id, set())
    for proc in procs:
        try:
            proc.kill()
        except Exception:  # noqa: BLE001 - already exited or unsupported
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass


def clear(run_id: int) -> None:
    """Drop registry entries for a run (on terminal, or before a retry)."""
    with _lock:
        _events.pop(run_id, None)
        _processes.pop(run_id, None)
