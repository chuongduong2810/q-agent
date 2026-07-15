"""HTTP tests for the agent-driven DOM exploration server-assist (#337, epic #336).

Covers the ``/agent/explore/*`` endpoints (all ``require_agent`` — a paired
device token), the async decide start+poll, the cost-budget short-circuit in
``exploration_agent.decide_next_action``, the progress relay, the KB-write
finalize, and the ``executionTarget`` dispatch branch on the existing
``POST /projects/{key}/repos/{repo}/explore`` endpoint.

Real engines only (ADR 0001): the browser + Claude never run here — the decide is
monkeypatched, the KB writer is spied, and the WS hub is spied. Only the HTTP
wiring, the in-memory queue/stores, and the dispatch branch are under test.
"""

from __future__ import annotations

import time

import pytest

from app.models.project_config import ProjectConfig
from app.routers import projects as projects_router
from app.services import (
    agent_device_service,
    agent_explore_service,
    auth_service,
    exploration_agent,
    settings_store,
)
from app.ws import hub


@pytest.fixture(autouse=True)
def _reset_explore_state():
    """Clear the module-level in-memory stores between tests (real isolation)."""
    agent_explore_service._pending.clear()
    agent_explore_service._results.clear()
    agent_explore_service._decide_jobs.clear()
    projects_router._exploring.clear()
    projects_router._explore_results.clear()
    yield
    agent_explore_service._pending.clear()
    agent_explore_service._results.clear()
    agent_explore_service._decide_jobs.clear()
    projects_router._exploring.clear()
    projects_router._explore_results.clear()


def _make_user(db_session, email: str, password: str = "password123"):
    from app.models.user import User

    user = User(
        email=email,
        first_name="Agent",
        last_name="Owner",
        password_hash=auth_service.hash_password(password),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client, email: str, password: str = "password123") -> str:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["accessToken"]


def _pair_device(db_session, user, name: str = "Test Device") -> str:
    """Pair a device for ``user`` and return its bearer token."""
    code = agent_device_service.create_pairing_code(db_session, user)
    _device, token = agent_device_service.redeem_pairing_code(db_session, code, name)
    return token


def _enqueue(owner_id, *, session_id="sess-1", project_key="Surency", repo="web", run_id=None):
    agent_explore_service.request_exploration(
        session_id,
        owner_id=owner_id,
        project_key=project_key,
        repo=repo,
        base_url="https://app.test",
        origin="https://app.test",
        target={"ticket": "SUR-1", "screen": "Divisions", "goal": "reach it"},
        max_steps=15,
        allow_state_changing=False,
        run_id=run_id,
        case_id=None,
    )


# ------------------------------------------------------------------- claim
def test_explore_next_204_when_empty(client, db_session):
    user = _make_user(db_session, "claim-empty@example.com")
    token = _pair_device(db_session, user)

    resp = client.post("/agent/explore/next", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204


def test_explore_next_returns_claim_payload(client, db_session):
    user = _make_user(db_session, "claim@example.com")
    token = _pair_device(db_session, user)
    _enqueue(user.id, run_id=42)

    resp = client.post("/agent/explore/next", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sessionId"] == "sess-1"
    assert body["baseUrl"] == "https://app.test"
    assert body["origin"] == "https://app.test"
    assert body["target"] == {"ticket": "SUR-1", "screen": "Divisions", "goal": "reach it"}
    assert body["maxSteps"] == 15
    assert body["allowStateChanging"] is False
    assert body["projectKey"] == "Surency"
    assert body["repo"] == "web"
    assert body["runId"] == 42

    # A second claim finds nothing queued (the session is now in-flight).
    again = client.post("/agent/explore/next", headers={"Authorization": f"Bearer {token}"})
    assert again.status_code == 204
    assert agent_explore_service.is_in_flight("Surency", "web") is True


# ------------------------------------------------------------------ decide
def _poll_decide(client, headers, session_id, job_id, timeout=5.0) -> dict:
    deadline = time.time() + timeout
    body: dict = {}
    while time.time() < deadline:
        resp = client.get(f"/agent/explore/{session_id}/decide/{job_id}", headers=headers)
        body = resp.json()
        if body["status"] != "running":
            return body
        time.sleep(0.02)
    return body


def test_decide_start_and_poll_returns_action(client, db_session, monkeypatch):
    user = _make_user(db_session, "decide@example.com")
    token = _pair_device(db_session, user)
    headers = {"Authorization": f"Bearer {token}"}
    _enqueue(user.id)

    monkeypatch.setattr(
        exploration_agent,
        "decide_next_action",
        lambda *a, **k: {"action": "click", "args": {"role": "tab", "name": "Divisions"}, "reasoning": "go"},
    )

    start = client.post(
        "/agent/explore/sess-1/decide",
        json={"observation": {"url": "/"}, "history": [], "stepsTaken": 0},
        headers=headers,
    )
    assert start.status_code == 200, start.text
    job_id = start.json()["jobId"]
    assert start.json()["status"] == "running"

    done = _poll_decide(client, headers, "sess-1", job_id)
    assert done["status"] == "done"
    assert done["result"]["action"] == "click"
    assert done["result"]["args"] == {"role": "tab", "name": "Divisions"}

    # Terminal jobs are popped on delivery.
    gone = client.get(f"/agent/explore/sess-1/decide/{job_id}", headers=headers)
    assert gone.status_code == 404


def test_decide_unknown_session_404(client, db_session):
    user = _make_user(db_session, "decide-404@example.com")
    token = _pair_device(db_session, user)
    resp = client.post(
        "/agent/explore/nope/decide",
        json={"observation": {}, "history": [], "stepsTaken": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


def test_decide_next_action_stops_on_budget(monkeypatch):
    """Real budget enforcement: spend at/over the ceiling returns stop/budget
    without any Claude call (no run_json)."""
    monkeypatch.setattr(exploration_agent.settings, "explore_cost_budget_usd", 0.10)
    monkeypatch.setattr(exploration_agent, "_session_spend", lambda db, run_id: {"usd": 0.99, "tokens": 500})
    called = []
    monkeypatch.setattr(exploration_agent, "run_json", lambda *a, **k: called.append(1))

    result = exploration_agent.decide_next_action(
        db=object(),
        target={"screen": "Divisions"},
        observation={"url": "/"},
        history=[],
        steps_taken=0,
        run_id=1,
        owner_id=1,
        max_steps=15,
    )
    assert result["stop"] is True
    assert result["stopReason"] == "budget"
    assert called == []  # halted before spending on a decision


# ------------------------------------------------------------------ events
def test_events_relay_to_hub_when_run(client, db_session, monkeypatch):
    user = _make_user(db_session, "events@example.com")
    token = _pair_device(db_session, user)
    _enqueue(user.id, run_id=77)

    published: list[tuple] = []
    monkeypatch.setattr(hub, "publish", lambda run_id, event, payload: published.append((run_id, event, payload)))

    resp = client.post(
        "/agent/explore/sess-1/events",
        json={"event": "explore.progress", "payload": {"step": 1}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert published == [("77", "explore.progress", {"step": 1})]


def test_events_no_run_is_noop(client, db_session, monkeypatch):
    user = _make_user(db_session, "events-norun@example.com")
    token = _pair_device(db_session, user)
    _enqueue(user.id, run_id=None)

    published: list[tuple] = []
    monkeypatch.setattr(hub, "publish", lambda *a: published.append(a))

    resp = client.post(
        "/agent/explore/sess-1/events",
        json={"event": "explore.progress", "payload": {}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert published == []  # a session with no run relays nothing


# ---------------------------------------------------------------- finalize
def test_finalize_with_discovered_writes_kb(client, db_session, monkeypatch):
    user = _make_user(db_session, "finalize@example.com")
    token = _pair_device(db_session, user)
    _enqueue(user.id)

    merge_calls: list[dict] = []

    def _fake_merge(project_key, repo, discovered, *, owner_id=None, source="exploration"):
        merge_calls.append({"project_key": project_key, "repo": repo, "discovered": discovered, "owner_id": owner_id})
        return len(discovered.get("routes", [])) + len(discovered.get("selectors", []))

    import app.routers.agent as agent_router

    monkeypatch.setattr(agent_router.knowledge_service, "merge_verified_discovery", _fake_merge)

    resp = client.post(
        "/agent/explore/sess-1/finalize",
        json={
            "discovered": {"routes": [{"path": "/divisions"}], "selectors": [{"selector": "#x"}]},
            "log": [],
            "stopReason": "done",
            "stepsTaken": 3,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "wroteKb": True}
    assert len(merge_calls) == 1
    assert merge_calls[0]["project_key"] == "Surency"
    assert merge_calls[0]["owner_id"] == user.id

    # The terminal result is stored for /explore/status and the session is no longer in-flight.
    assert agent_explore_service.is_in_flight("Surency", "web") is False
    stored = agent_explore_service.get_result_for("Surency", "web")
    assert stored["stopReason"] == "done" and stored["wroteKb"] is True


def test_finalize_empty_discovered_no_kb_write(client, db_session, monkeypatch):
    user = _make_user(db_session, "finalize-empty@example.com")
    token = _pair_device(db_session, user)
    _enqueue(user.id)

    import app.routers.agent as agent_router

    merge_calls: list = []
    monkeypatch.setattr(
        agent_router.knowledge_service,
        "merge_verified_discovery",
        lambda *a, **k: merge_calls.append(a) or 1,
    )

    resp = client.post(
        "/agent/explore/sess-1/finalize",
        json={"discovered": {"routes": [], "selectors": []}, "log": [], "stopReason": "unreachable", "stepsTaken": 2},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "wroteKb": False}
    assert merge_calls == []  # never invent: no observed data → no KB write


# -------------------------------------------------------- dispatch branch
def _seed_config(db_session, key="Surency", repo="web", owner_id=None):
    db_session.add(
        ProjectConfig(key=key, name=key, repos=[{"name": repo, "default": True}], owner_id=owner_id)
    )
    db_session.commit()


def test_dispatch_local_agent_enqueues_and_returns_mode(client, db_session, monkeypatch):
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)
    monkeypatch.setattr(settings_store, "load_settings", lambda: {"executionTarget": "local-agent"})

    user = _make_user(db_session, "dispatch@example.com")
    _pair_device(db_session, user)
    _seed_config(db_session, key="Surency", repo="web", owner_id=user.id)
    token = _login(client, "dispatch@example.com")

    resp = client.post(
        "/projects/Surency/repos/web/explore",
        json={"target": {"screen": "Divisions"}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["started"] is True
    assert body["mode"] == "local-agent"
    assert isinstance(body["sessionId"], str) and body["sessionId"]

    # The session is queued for the agent + reported in-flight by status.
    assert agent_explore_service.is_in_flight("Surency", "web") is True
    status = client.get(
        "/projects/Surency/repos/web/explore/status", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert status["exploring"] is True
    assert status["sessionId"] == body["sessionId"]


def test_dispatch_local_agent_409_without_device(client, db_session, monkeypatch):
    monkeypatch.setattr(settings_store, "load_settings", lambda: {"executionTarget": "local-agent"})
    # No device paired; auth off → owner_id is None and no device matches.
    _seed_config(db_session, key="Surency", repo="web", owner_id=None)

    resp = client.post(
        "/projects/Surency/repos/web/explore",
        json={"target": {"screen": "Divisions"}},
    )
    assert resp.status_code == 409


def test_dispatch_server_target_unaffected(client, db_session, monkeypatch):
    """The default (server) target keeps the in-process background-thread path."""
    monkeypatch.setattr(settings_store, "load_settings", lambda: {"executionTarget": "server"})
    _seed_config(db_session, key="Surency", repo="web", owner_id=None)

    started = []
    monkeypatch.setattr(exploration_agent, "explore", lambda *a, **k: started.append(1))

    resp = client.post(
        "/projects/Surency/repos/web/explore",
        json={"target": {"screen": "Divisions"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["started"] is True
    assert body.get("mode") is None  # server path sets no agent mode
    assert agent_explore_service.is_in_flight("Surency", "web") is False
