"""In-memory queue for agent-driven live authoring sessions (#403).

Mirrors :mod:`agent_explore_service`: when authoring mode is ``live-harness`` and
the execution target is the paired Local Agent, generation enqueues one authoring
session per case here. The agent claims it (``POST /agent/authoring/next``), runs
``claude`` + ``browser-harness`` locally to author the spec, and posts the result
to ``POST /agent/authoring/{id}/finalize`` — which persists the spec via the
shared gate/write path. All state is transient: a server restart mid-session just
means the operator re-triggers generation.
"""

from __future__ import annotations

import threading

_lock = threading.Lock()

# Queued/claimed sessions. Each entry carries everything the agent needs to run
# authoring locally (prompts are composed server-side). status ∈ {queued, running};
# removed once finalized (see set_result).
_pending: list[dict] = []

# Latest terminal outcome per (project_key, repo) for status reporting.
_results: dict[tuple[str, str], dict] = {}


def request_authoring(
    session_id: str,
    *,
    owner_id: int | None,
    project_key: str,
    repo: str,
    base_url: str,
    origin: str,
    case_id: int,
    run_id: int | None,
    spec_filename: str,
    system_prompt: str,
    task_prompt: str,
    model: str,
    max_budget_usd: float,
) -> None:
    """Enqueue one authoring session for the paired agent to claim."""
    with _lock:
        _pending.append(
            {
                "session_id": session_id,
                "owner_id": owner_id,
                "project_key": project_key,
                "repo": repo,
                "base_url": base_url,
                "origin": origin,
                "case_id": case_id,
                "run_id": run_id,
                "spec_filename": spec_filename,
                "system_prompt": system_prompt,
                "task_prompt": task_prompt,
                "model": model,
                "max_budget_usd": max_budget_usd,
                "status": "queued",
            }
        )


def claim_next(owner_id: int | None) -> dict | None:
    """Claim the oldest queued session for ``owner_id``; flip it to running."""
    with _lock:
        for s in _pending:
            if s["owner_id"] == owner_id and s["status"] == "queued":
                s["status"] = "running"
                return dict(s)
    return None


def get_session(session_id: str, owner_id: int | None = None) -> dict | None:
    """Return a copy of a tracked session, optionally scoped to ``owner_id``."""
    with _lock:
        for s in _pending:
            if s["session_id"] == session_id and (
                owner_id is None or s["owner_id"] == owner_id
            ):
                return dict(s)
    return None


def set_result(session_id: str, result: dict) -> None:
    """Store a session's terminal result (keyed by project/repo) and drop it."""
    with _lock:
        for s in _pending:
            if s["session_id"] == session_id:
                _results[(s["project_key"], s["repo"])] = {"sessionId": session_id, **result}
                _pending.remove(s)
                return


def get_result_for(project_key: str, repo: str) -> dict | None:
    with _lock:
        return _results.get((project_key, repo))


def is_in_flight(project_key: str, repo: str) -> bool:
    with _lock:
        return any(
            s["project_key"] == project_key and s["repo"] == repo for s in _pending
        )
