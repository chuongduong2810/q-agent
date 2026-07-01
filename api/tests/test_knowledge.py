"""Tests for Project Knowledge build + endpoints (Claude mocked)."""

from __future__ import annotations

from app.services import knowledge_service

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


def test_build_knowledge_indexes_project(client, monkeypatch):
    monkeypatch.setattr(knowledge_service, "run_json", lambda *a, **k: dict(CANNED))

    resp = client.post(
        "/projects/Surency Platform/knowledge/build",
        json={"name": "Surency Platform", "provider": "Azure DevOps", "repo": "org/web"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "indexed"
    assert data["confidence"] == 88
    assert data["version"] == "v1"
    assert data["knowledge"]["stack"] == ["React 19", "TypeScript"]

    # A rebuild bumps the version and keeps it indexed.
    resp2 = client.post("/projects/Surency Platform/knowledge/build", json={})
    assert resp2.json()["version"] == "v2"

    listed = client.get("/projects/knowledge").json()
    assert any(k["key"] == "Surency Platform" for k in listed)


def test_get_knowledge_404_when_absent(client):
    assert client.get("/projects/Ghost/knowledge").status_code == 404


def test_build_surfaces_claude_error(client, monkeypatch):
    from app.services.claude_cli import ClaudeError

    def boom(*a, **k):
        raise ClaudeError("cli missing")

    monkeypatch.setattr(knowledge_service, "run_json", boom)
    resp = client.post("/projects/X/knowledge/build", json={"name": "X"})
    assert resp.status_code == 502
