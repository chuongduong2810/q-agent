"""HTTP tests for the DOM-exploration endpoints (#327, ADR 0010 §7).

Exercises the async start + poll contract of
``POST /projects/{key}/repos/{repo}/explore`` and
``GET  /projects/{key}/repos/{repo}/explore/status``. The exploration service
itself (real browser + Claude, per ADR 0001) is monkeypatched with a fast fake so
these tests stay hermetic — only the HTTP wiring, the background-thread lifecycle,
and the resolve/authorize 404s are under test here.
"""

from __future__ import annotations

import time

import pytest

from app.models.project_config import ProjectConfig
from app.routers import projects as projects_router
from app.services import auth_service, exploration_agent
from app.services.exploration_agent import ExplorationResult


@pytest.fixture(autouse=True)
def _reset_explore_state():
    """The router's in-flight/result maps are module-level; clear them between
    tests so per-test state never leaks (real isolation)."""
    projects_router._exploring.clear()
    projects_router._explore_results.clear()
    yield
    projects_router._exploring.clear()
    projects_router._explore_results.clear()


def _seed_config(db_session, key: str = "Surency", repo: str = "web", owner_id=None):
    """Seed a ProjectConfig with a single configured repo (owner-scoped)."""
    db_session.add(
        ProjectConfig(
            key=key,
            name=key,
            repos=[{"name": repo, "default": True}],
            owner_id=owner_id,
        )
    )
    db_session.commit()


def _fake_explore(
    db,
    *,
    project_key,
    repo,
    target,
    run_id=None,
    case_id=None,
    owner_id=None,
    on_step=None,
    allow_state_changing=False,
):
    """Fast stand-in for ``exploration_agent.explore`` — no browser, no Claude."""
    if on_step:
        on_step(
            {
                "step": 1,
                "action": "goto",
                "args": {"url": "/x"},
                "observedUrl": "/x",
                "spentUsd": 0.0,
                "remainingBudgetUsd": 1.0,
            }
        )
    return ExplorationResult(
        discovered={
            "routes": [{"path": "/x"}],
            "selectors": [{"selector": '[data-testid="a"]'}],
        },
        log=[{"step": 1, "action": "done", "args": {}}],
        stop_reason="done",
        steps_taken=1,
        budget_spent={"usd": 0.0, "tokens": 0},
        wrote_kb=True,
    )


def _wait_terminal(client, key: str, repo: str, timeout: float = 5.0) -> dict:
    """Poll the status endpoint until the background session reports a terminal
    (idle + stop reason) result, or time out."""
    deadline = time.time() + timeout
    body: dict = {}
    while time.time() < deadline:
        body = client.get(f"/projects/{key}/repos/{repo}/explore/status").json()
        if not body["exploring"] and body.get("stopReason") is not None:
            return body
        time.sleep(0.02)
    return body


def test_explore_start_returns_session_immediately(client, db_session, monkeypatch):
    _seed_config(db_session)
    monkeypatch.setattr(exploration_agent, "explore", _fake_explore)

    resp = client.post(
        "/projects/Surency/repos/web/explore",
        json={"target": {"ticket": "SUR-1", "screen": "Divisions"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["started"] is True
    assert isinstance(body["sessionId"], str) and body["sessionId"]


def test_status_idle_before_and_terminal_after(client, db_session, monkeypatch):
    _seed_config(db_session)
    monkeypatch.setattr(exploration_agent, "explore", _fake_explore)

    # Idle before any session.
    before = client.get("/projects/Surency/repos/web/explore/status").json()
    assert before["exploring"] is False
    assert before["sessionId"] is None

    start = client.post(
        "/projects/Surency/repos/web/explore",
        json={"target": {"screen": "Divisions"}},
    )
    session_id = start.json()["sessionId"]

    # After the background thread completes, the terminal summary is reported.
    after = _wait_terminal(client, "Surency", "web")
    assert after["exploring"] is False
    assert after["sessionId"] == session_id
    assert after["stopReason"] == "done"
    assert after["stepsTaken"] == 1
    assert after["wroteKb"] is True
    assert after["discoveredRoutes"] == 1
    assert after["discoveredSelectors"] == 1


def test_404_unconfigured_repo(client, db_session, monkeypatch):
    _seed_config(db_session, repo="web")
    monkeypatch.setattr(exploration_agent, "explore", _fake_explore)

    resp = client.post(
        "/projects/Surency/repos/nope/explore",
        json={"target": {"screen": "X"}},
    )
    assert resp.status_code == 404
    status = client.get("/projects/Surency/repos/nope/explore/status")
    assert status.status_code == 404


def test_404_foreign_project_config(client, db_session, monkeypatch):
    """A config owned by another user 404s for the requesting user (#93)."""
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)
    monkeypatch.setattr(exploration_agent, "explore", _fake_explore)

    owner = _make_user(db_session, "owner@example.com")
    _make_user(db_session, "intruder@example.com")
    _seed_config(db_session, key="Owned", repo="web", owner_id=owner.id)

    token = _login(client, "intruder@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post(
        "/projects/Owned/repos/web/explore",
        json={"target": {"screen": "X"}},
        headers=headers,
    )
    assert resp.status_code == 404
    status = client.get("/projects/Owned/repos/web/explore/status", headers=headers)
    assert status.status_code == 404


def _make_user(db_session, email: str, password: str = "password123"):
    from app.models.user import User

    user = User(
        email=email,
        first_name="Test",
        last_name="User",
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
