"""Tests for multi-repo management: discovery, config, and per-repo knowledge."""

from __future__ import annotations

import time

from app.models.knowledge import compose_key
from app.models.provider_connection import ProviderConnection
from app.services import knowledge_service, repo_service
from app.services.adapters.base import ProviderAdapter


def _wait_idle(row_key: str, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while knowledge_service.is_building(row_key) and time.time() < deadline:
        time.sleep(0.02)


class _FakeAdapter(ProviderAdapter):
    kind = "github"

    def test_connection(self):  # pragma: no cover
        return {"ok": True, "message": "", "detail": {}}

    def list_projects(self):  # pragma: no cover
        return []

    def fetch_tickets(self, **kwargs):  # pragma: no cover
        return []

    def publish_comment(self, *a, **k):  # pragma: no cover
        return "1"

    def list_repos(self):
        return [
            {"name": "surency-web", "clone_url": "https://ado/o/_git/surency-web",
             "web_url": "https://ado/web", "default_branch": "main"},
            {"name": "surency-api", "clone_url": "https://ado/o/_git/surency-api",
             "web_url": "https://ado/api", "default_branch": "main"},
        ]


def _seed_provider(db):
    """Seed a work-item (ADO) connection for project-key resolution and a
    repository (GitHub) connection for repo discovery (ADR 0006)."""
    db.add(ProviderConnection(kind="ado", name="ADO", connected=True,
                              config={"project": "Surency Platform"}, secrets={}))
    db.add(ProviderConnection(kind="github", name="GitHub", connected=True,
                              config={"org": "surency-eng"}, secrets={}))
    db.commit()


CANNED = {"branch": "main", "stack": ["React"], "architecture": "SPA", "domain": "Benefits",
          "locator": "getByRole", "base_url": "https://app.test", "routes": [], "selectors": [],
          "auth": {}, "confidence": 90}


def test_discover_available_repos(client, db_session, monkeypatch):
    _seed_provider(db_session)
    from app.routers import projects as projects_router

    monkeypatch.setattr(projects_router, "get_adapter", lambda kind, config, secrets: _FakeAdapter({}, {}))
    data = client.get("/projects/Surency Platform/repos/available").json()
    assert data["provider"] == "github"  # discovery routes via the repository connection
    assert {r["name"] for r in data["repos"]} == {"surency-web", "surency-api"}


def test_config_repos_roundtrip_and_default(client):
    resp = client.put(
        "/projects/Surency Platform/config",
        json={"repos": [
            {"name": "surency-web", "repoUrl": "https://ado/o/_git/surency-web"},
            {"name": "surency-api", "repoUrl": "https://ado/o/_git/surency-api"},
        ]},
    )
    assert resp.status_code == 200
    repos = resp.json()["repos"]
    assert [r["name"] for r in repos] == ["surency-web", "surency-api"]
    # First repo becomes the default automation target when none is flagged.
    assert repos[0]["default"] is True
    assert repos[1]["default"] is False


def test_build_per_repo_knowledge(client, db_session, monkeypatch):
    _seed_provider(db_session)
    client.put(
        "/projects/Surency Platform/config",
        json={"repos": [{"name": "surency-web", "repoUrl": "https://ado/o/_git/surency-web", "default": True}]},
    )
    monkeypatch.setattr(knowledge_service, "run_json", lambda *a, **k: dict(CANNED))
    # Don't actually clone in a test.
    monkeypatch.setattr(repo_service, "resolve_one_repo", lambda *a, **k: None)

    resp = client.post(
        "/projects/Surency Platform/repos/surency-web/knowledge/build",
        json={"provider": "Azure DevOps"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "Surency Platform::surency-web"
    assert body["projectKey"] == "Surency Platform"
    assert body["repo"] == "surency-web"
    assert body["status"] == "indexing"  # async — completes in the background

    _wait_idle(compose_key("Surency Platform", "surency-web"))

    # The repos listing reflects the per-repo KB status.
    repos = client.get("/projects/Surency Platform/repos").json()
    web = next(r for r in repos if r["name"] == "surency-web")
    assert web["status"] == "indexed"
    assert web["default"] is True

    # And the per-repo KB is fetchable.
    kn = client.get("/projects/Surency Platform/repos/surency-web/knowledge").json()
    assert kn["knowledge"]["stack"] == ["React"]


def test_build_unknown_repo_404(client, db_session):
    _seed_provider(db_session)
    resp = client.post("/projects/Surency Platform/repos/ghost/knowledge/build", json={})
    assert resp.status_code == 404


def test_build_context_uses_default_repo_knowledge(client, db_session, monkeypatch):
    _seed_provider(db_session)
    client.put(
        "/projects/Surency Platform/config",
        json={
            "repos": [
                {"name": "surency-web", "repoUrl": "https://ado/o/_git/surency-web", "default": True},
                {"name": "surency-api", "repoUrl": "https://ado/o/_git/surency-api"},
            ],
            "testAccounts": [{"role": "Admin", "username": "u", "password": "p", "notes": ""}],
        },
    )
    monkeypatch.setattr(knowledge_service, "run_json", lambda *a, **k: dict(CANNED, domain="WEB-DOMAIN"))
    monkeypatch.setattr(repo_service, "resolve_one_repo", lambda *a, **k: None)
    client.post("/projects/Surency Platform/repos/surency-web/knowledge/build", json={})
    _wait_idle(compose_key("Surency Platform", "surency-web"))

    from app.models.ticket import Ticket
    from app.services import project_config_service

    ticket = Ticket(external_id="SUR-1", provider_kind="ado", title="t")
    db_session.add(ticket)
    db_session.commit()

    ctx = project_config_service.build_context(db_session, ticket)
    assert ctx["projectKey"] == "Surency Platform"
    assert ctx["repo"] == "surency-web"
    assert ctx["domain"] == "WEB-DOMAIN"  # pulled from the default repo's KB
    assert ctx["testAccounts"][0]["password"] == "p"
