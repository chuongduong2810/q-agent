"""Agent-driven DOM exploration — in-memory session queue + result/decide stores.

The DOM Exploration Agent's observe→decide→act loop runs on the paired Local
Agent (Playwright + network access to the app-under-test), mirroring how
Execution and Self-heal drive real browsers there (epic #336, ADR 0010). This
module is the server-side coordination the agent path needs — the exact analogue
of :mod:`app.services.agent_capture_service`:

* a **pending-session queue** the agent claims via ``POST /agent/explore/next``;
* a **terminal-result + in-flight store** keyed by ``(project_key, repo)`` so the
  existing ``/explore/status`` endpoint can report the agent path too;
* an **async decide-job store** for ``POST /agent/explore/{id}/decide`` +
  ``GET  .../decide/{job}`` — the per-step Claude call is a slow (~minutes)
  request, so it runs on a background thread and the agent polls for the result
  (mirrors ``routers/agent.py::_heal_fix_jobs``, beating the ~100s proxy cap).

All state is in-memory and transient: an exploration session is a
seconds-to-minutes request, and if the server restarts mid-session the operator
simply re-triggers. Persistent KB output is written by ``finalize`` via
:func:`app.services.knowledge_service.merge_verified_discovery`.
"""

from __future__ import annotations

import threading
import uuid

_lock = threading.Lock()

# Queued/claimed sessions. Each entry:
#   {session_id, owner_id, project_key, repo, base_url, origin, target,
#    max_steps, allow_state_changing, run_id, case_id, status}
# status ∈ {"queued", "running"}. Removed once finalized (see set_result).
_pending: list[dict] = []

# Latest terminal outcome per (project_key, repo): the finalize summary the
# status endpoint reports (sessionId, status, stopReason, stepsTaken, wroteKb, …).
_results: dict[tuple[str, str], dict] = {}

# Async decide jobs: job_id -> {"status": running|done|error, "result"|"error"}.
_decide_jobs: dict[str, dict] = {}
_decide_lock = threading.Lock()


def request_exploration(
    session_id: str,
    *,
    owner_id: int | None,
    project_key: str,
    repo: str,
    base_url: str,
    origin: str,
    target: dict,
    max_steps: int,
    allow_state_changing: bool,
    run_id: int | None,
    case_id: int | None,
) -> None:
    """Enqueue an exploration session for the owner's paired agent to claim.

    Args:
        session_id: The server-generated session id (also the WS/finalize key).
        owner_id: Workspace owner whose paired agent may claim this session.
        project_key: The project being explored.
        repo: Target repository name ("" for the legacy project-level KB).
        base_url: Resolved application base URL the agent drives.
        origin: Scheme+host the agent keys its captured session on.
        target: What to discover — ``{"ticket", "screen", "goal"}``.
        max_steps: Step cap for the loop (already clamped by the caller).
        allow_state_changing: Whether ``fill`` / submit clicks are permitted.
        run_id: Run to attribute per-step Claude spend to + stream progress on.
        case_id: The blocked case that triggered exploration (carried through).
    """
    with _lock:
        _pending.append(
            {
                "session_id": session_id,
                "owner_id": owner_id,
                "project_key": project_key,
                "repo": repo,
                "base_url": base_url,
                "origin": origin,
                "target": target,
                "max_steps": max_steps,
                "allow_state_changing": allow_state_changing,
                "run_id": run_id,
                "case_id": case_id,
                "status": "queued",
                # Run spend (USD) captured at the first decide, so the cost
                # budget measures only THIS session's decide calls — not the
                # run's lifetime AI spend (analysis/generation). None until set.
                "baseline_usd": None,
            }
        )


def purge_run(run_id: int) -> int:
    """Drop every pending exploration session for a run (#420); return how many.

    Called when a run is stopped so an unclaimed/queued session can't be picked up
    by the agent after cancellation.
    """
    with _lock:
        before = len(_pending)
        _pending[:] = [s for s in _pending if s.get("run_id") != run_id]
        return before - len(_pending)


def claim_next(owner_id: int | None) -> dict | None:
    """Claim the oldest queued session for ``owner_id`` (marks it running).

    Returns a copy of the claimed session dict, or ``None`` when nothing is
    queued (the endpoint answers 204). The session stays tracked (in-flight)
    until :func:`set_result` removes it on finalize.
    """
    with _lock:
        for s in _pending:
            if s["owner_id"] == owner_id and s["status"] == "queued":
                s["status"] = "running"
                return dict(s)
    return None


def get_session(session_id: str, owner_id: int | None = None) -> dict | None:
    """Return a copy of the tracked session, scoped to ``owner_id`` when given."""
    with _lock:
        for s in _pending:
            if s["session_id"] == session_id and (
                owner_id is None or s["owner_id"] == owner_id
            ):
                return dict(s)
    return None


def ensure_baseline(session_id: str, spend_usd: float) -> float:
    """Record the run's pre-exploration spend once (at the first decide) and return it.

    The per-session cost budget must measure only this exploration's own decide
    calls, not the run's lifetime AI spend. The first decide captures the run's
    current spend as the baseline; every decide then charges ``current - baseline``
    against the budget. Idempotent: later calls return the stored baseline and
    ignore ``spend_usd``.

    Args:
        session_id: The exploration session.
        spend_usd: The run's current cumulative Claude spend (USD), read by the
            caller at first-decide time.

    Returns:
        The effective baseline USD for the session (the stored one once set).
    """
    with _lock:
        for s in _pending:
            if s["session_id"] == session_id:
                if s.get("baseline_usd") is None:
                    s["baseline_usd"] = float(spend_usd)
                return float(s["baseline_usd"])
    return float(spend_usd)


def set_result(session_id: str, result: dict) -> None:
    """Store the terminal result for a session and stop tracking it.

    Keys the result by the session's ``(project_key, repo)`` so
    :func:`get_result_for` can report it to ``/explore/status``. No-op if the
    session is unknown (already finalized / lost on restart).
    """
    with _lock:
        for s in _pending:
            if s["session_id"] == session_id:
                _results[(s["project_key"], s["repo"])] = {
                    "sessionId": session_id,
                    **result,
                }
                _pending.remove(s)
                return


def get_result_for(project_key: str, repo: str) -> dict | None:
    """Return the latest terminal result for ``(project_key, repo)``, or None."""
    with _lock:
        return _results.get((project_key, repo))


def in_flight_session_id(project_key: str, repo: str) -> str | None:
    """Return the id of a queued/running session for ``(project_key, repo)``, else None."""
    with _lock:
        for s in _pending:
            if s["project_key"] == project_key and s["repo"] == repo:
                return s["session_id"]
    return None


def is_in_flight(project_key: str, repo: str) -> bool:
    """True while a session for ``(project_key, repo)`` is queued or running."""
    return in_flight_session_id(project_key, repo) is not None


# --------------------------------------------------------------- decide jobs
def start_decide_job() -> str:
    """Register a new running decide job and return its id."""
    job_id = uuid.uuid4().hex
    with _decide_lock:
        _decide_jobs[job_id] = {"status": "running"}
    return job_id


def finish_decide_job(job_id: str, *, result: dict | None = None, error: str | None = None) -> None:
    """Record a decide job's terminal outcome (a ``result`` dict or an ``error``)."""
    with _decide_lock:
        if error is not None:
            _decide_jobs[job_id] = {"status": "error", "error": error}
        else:
            _decide_jobs[job_id] = {"status": "done", "result": result}


def take_decide_job(job_id: str) -> dict | None:
    """Return a decide job, popping it if terminal (so the store stays bounded).

    ``None`` when the id is unknown (e.g. the API restarted mid-decide).
    """
    with _decide_lock:
        job = _decide_jobs.get(job_id)
        if job is not None and job["status"] in ("done", "error"):
            _decide_jobs.pop(job_id, None)
        return job
