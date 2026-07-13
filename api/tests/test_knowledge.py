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


# --- Heal->KB DOM enrichment (#249) ------------------------------------------


def _seed_kb_row(db_session, key="Surency Platform", routes=None, selectors=None):
    from app.models.knowledge import ProjectKnowledge

    row = ProjectKnowledge(
        key=key,
        project_key=key,
        name=key,
        owner_id=None,
        status="indexed",
        knowledge={"routes": routes or [], "selectors": selectors or []},
    )
    db_session.add(row)
    db_session.commit()
    return row


def _reload_kb(db_session, key="Surency Platform"):
    from app.models.knowledge import ProjectKnowledge

    db_session.expire_all()
    return db_session.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()


def test_merge_discovered_dom_adds_new_route_and_selectors(db_session):
    _seed_kb_row(db_session)

    added = knowledge_service.merge_discovered_dom(
        "Surency Platform", "", {"route": "/login", "selectors": ["#login-submit"]}, None
    )
    assert added == 2

    kn = _reload_kb(db_session).knowledge
    assert any(r["path"] == "/login" and r.get("source") == "dom-heal" for r in kn["routes"])
    sel = next(s for s in kn["selectors"] if s["selector"] == "#login-submit")
    assert sel["source"] == "dom-heal"
    assert sel["screen"] == "login"
    assert sel["element"] == "login-submit"


def test_merge_discovered_dom_dedups_existing(db_session):
    _seed_kb_row(
        db_session,
        routes=[{"path": "/login"}],
        selectors=[{"screen": "login", "element": "submit", "selector": "#login-submit"}],
    )

    # Only the genuinely-new selector is added; existing route + selector are untouched.
    added = knowledge_service.merge_discovered_dom(
        "Surency Platform", "", {"route": "/login", "selectors": ["#login-submit", "#remember"]}, None
    )
    assert added == 1

    kn = _reload_kb(db_session).knowledge
    assert [r["path"] for r in kn["routes"]] == ["/login"]
    assert sorted(s["selector"] for s in kn["selectors"]) == ["#login-submit", "#remember"]


def test_merge_discovered_dom_noop_without_row(db_session):
    assert knowledge_service.merge_discovered_dom("Ghost", "", {"route": "/x"}, None) == 0


def test_merge_discovered_dom_noop_when_nothing_discovered(db_session):
    _seed_kb_row(db_session)
    assert knowledge_service.merge_discovered_dom(
        "Surency Platform", "", {"route": "", "selectors": []}, None
    ) == 0


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


def _seed_knowledge_row(db_session, *, key, project_key, repo="", selector="#old-login"):
    """A minimal indexed ProjectKnowledge row with one selector entry (#182)."""
    from app.models.knowledge import ProjectKnowledge

    row = ProjectKnowledge(
        key=key,
        project_key=project_key,
        name=project_key,
        repo=repo,
        status="indexed",
        confidence=90,
        knowledge={
            "selectors": [{"screen": "Login", "element": "Submit", "selector": selector}],
        },
        owner_id=None,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_propose_selector_fix_updates_matching_kb_entry(db_session):
    """A self-heal's corrected selector is written back into the KB entry that
    carried the old (broken) value — #182 heal->KB feedback."""
    from app.models.knowledge import ProjectKnowledge, compose_key

    _seed_knowledge_row(
        db_session, key=compose_key("Surency Platform", "org/web"),
        project_key="Surency Platform", repo="org/web", selector="#old-login",
    )

    updated = knowledge_service.propose_selector_fix(
        "Surency Platform", "org/web", "#old-login", "#new-login", None
    )
    assert updated is True

    row = (
        db_session.query(ProjectKnowledge)
        .filter(ProjectKnowledge.key == compose_key("Surency Platform", "org/web"))
        .first()
    )
    db_session.refresh(row)
    assert row.knowledge["selectors"][0]["selector"] == "#new-login"
    # The unrelated fields on that same entry are preserved.
    assert row.knowledge["selectors"][0]["screen"] == "Login"


def test_propose_selector_fix_falls_back_to_project_level_row(db_session):
    """No per-repo row -> falls back to the legacy project-level row (repo='')."""
    from app.models.knowledge import ProjectKnowledge

    _seed_knowledge_row(
        db_session, key="Surency Platform", project_key="Surency Platform",
        repo="", selector="#old-login",
    )

    updated = knowledge_service.propose_selector_fix(
        "Surency Platform", "org/web", "#old-login", "#new-login", None
    )
    assert updated is True
    row = db_session.query(ProjectKnowledge).filter(ProjectKnowledge.key == "Surency Platform").first()
    db_session.refresh(row)
    assert row.knowledge["selectors"][0]["selector"] == "#new-login"


def test_propose_selector_fix_noop_when_no_matching_selector(db_session):
    _seed_knowledge_row(
        db_session, key="Surency Platform", project_key="Surency Platform",
        selector="#unrelated",
    )
    updated = knowledge_service.propose_selector_fix(
        "Surency Platform", "", "#old-login", "#new-login", None
    )
    assert updated is False


def test_propose_selector_fix_noop_when_no_project_key_or_kb_row():
    assert knowledge_service.propose_selector_fix("", "", "#a", "#b", None) is False
    assert knowledge_service.propose_selector_fix("Ghost Project", "", "#a", "#b", None) is False
