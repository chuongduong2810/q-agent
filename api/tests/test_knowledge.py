"""Tests for Project Knowledge build + endpoints (Claude mocked, async build)."""

from __future__ import annotations

import time

from app.services import knowledge_service, repo_service

CANNED = {
    "branch": "main",
    "stack": ["React 19", "TypeScript"],
    "architecture": "Feature-modular SPA over a REST API.",
    "domain": "Benefits administration.",
    "locator": "getByRole + data-testid.",
    "assets": 40,
    "pageObjects": 12,
    "fixtures": 4,
    "utilities": ["api-client.ts"],
    "confidence": 88,
}


def _wait_idle(row_key: str, timeout: float = 5.0) -> None:
    """Block until the background knowledge build for a row finishes."""
    deadline = time.time() + timeout
    while knowledge_service.is_building(row_key) and time.time() < deadline:
        time.sleep(0.02)


def test_build_knowledge_indexes_project(client, monkeypatch):
    monkeypatch.setattr(knowledge_service, "run_json", lambda *a, **k: dict(CANNED))
    monkeypatch.setattr(repo_service, "resolve_repo_path", lambda *a, **k: None)

    resp = client.post(
        "/projects/Surency Platform/knowledge/build",
        json={"name": "Surency Platform", "provider": "Azure DevOps", "repo": "org/web"},
    )
    assert resp.status_code == 200
    # The build is async: the row is 'indexing' immediately, then completes.
    assert resp.json()["status"] == "indexing"
    _wait_idle("Surency Platform")

    data = client.get("/projects/Surency Platform/knowledge").json()
    assert data["status"] == "indexed"
    assert data["confidence"] == 88
    assert data["version"] == "v1"
    assert data["knowledge"]["stack"] == ["React 19", "TypeScript"]

    # A rebuild bumps the version and keeps it indexed.
    client.post("/projects/Surency Platform/knowledge/build", json={})
    _wait_idle("Surency Platform")
    assert client.get("/projects/Surency Platform/knowledge").json()["version"] == "v2"

    listed = client.get("/projects/knowledge").json()
    assert any(k["key"] == "Surency Platform" for k in listed)


def test_get_knowledge_404_when_absent(client):
    assert client.get("/projects/Ghost/knowledge").status_code == 404


def test_build_surfaces_claude_error(client, monkeypatch):
    from app.services.claude_cli import ClaudeError

    def boom(*a, **k):
        raise ClaudeError("cli missing")

    monkeypatch.setattr(knowledge_service, "run_json", boom)
    monkeypatch.setattr(repo_service, "resolve_repo_path", lambda *a, **k: None)

    resp = client.post("/projects/X/knowledge/build", json={"name": "X"})
    assert resp.status_code == 200  # accepted; failure surfaces on the row
    _wait_idle("X")

    row = client.get("/projects/X/knowledge").json()
    assert row["status"] == "error"
    assert "cli missing" in row["lastError"]
