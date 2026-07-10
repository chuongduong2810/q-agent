"""Tests for cloning a shared-namespace project + admin shared management (#120, ADR 0009 §2/§4).

Covers ``app.services.clone_service`` end-to-end via the ``/shared/projects``
router: a seeded shared project (``owner_id=None``) — config with an
encrypted test account, a knowledge row, and on-disk knowledge files — clones
into an authenticated member's own scope (rows re-stamped, secrets decrypt
identically, files copied under ``users/<id>/…``). Also covers the 404/409
clone semantics and that shared-namespace writes are admin-only.
"""

from __future__ import annotations

from app import crypto
from app.models.knowledge import ProjectKnowledge
from app.models.project import Project
from app.models.project_config import ProjectConfig
from app.models.user import User
from app.services import auth_service, knowledge_service
from app.services.workspace_scope import scoped_knowledge_dir, slug

PROJECT_KEY = "Surency Platform"


def _make_user(db_session, email, password="password123", role="member"):
    user = User(
        email=email,
        first_name="Test",
        last_name="User",
        role=role,
        password_hash=auth_service.hash_password(password),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _auth_headers(user) -> dict:
    token = auth_service.create_access_token(user, sid="test-sid")
    return {"Authorization": f"Bearer {token}"}


def _auth_on(monkeypatch):
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)


def _seed_shared_project(db_session, key: str = PROJECT_KEY) -> dict:
    """Seed a shared (``owner_id=None``) project: Project + ProjectConfig (with an
    encrypted test account) + ProjectKnowledge row + on-disk knowledge files."""
    db_session.add(
        Project(provider_kind="ado", external_id="shared-1", name=key, active=True, owner_id=None)
    )
    config = ProjectConfig(
        key=key,
        name=key,
        base_url="https://shared.surency.test",
        test_accounts=[
            {
                "role": "Internal Admin",
                "username": "qa@surency.test",
                "password": crypto.encrypt("s3cret!"),
                "notes": "seeded",
            }
        ],
        owner_id=None,
    )
    db_session.add(config)
    knowledge = ProjectKnowledge(
        key=key,
        project_key=key,
        name=key,
        provider="Azure DevOps",
        status="indexed",
        confidence=90,
        knowledge={"stack": ["React"]},
        owner_id=None,
    )
    db_session.add(knowledge)
    db_session.commit()

    out_dir = scoped_knowledge_dir(None) / slug(key)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "knowledge.json").write_text("{}", encoding="utf-8")
    (out_dir / "knowledge.md").write_text("# Surency Platform", encoding="utf-8")
    knowledge.doc_path = str(out_dir)
    db_session.commit()

    return {"config": config, "knowledge": knowledge}


# --------------------------------------------------------------------- clone
def test_clone_copies_rows_and_files_and_decrypts_secrets(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    _seed_shared_project(db_session)
    user = _make_user(db_session, "member@example.com")
    headers = _auth_headers(user)

    resp = client.post(f"/shared/projects/{PROJECT_KEY}/clone", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["projectKey"] == PROJECT_KEY
    assert body["projectsCloned"] == 1
    assert body["configCloned"] is True
    assert body["knowledgeCloned"] == [PROJECT_KEY]
    assert set(body["artifactsCopied"]) == {"knowledge"}

    # Rows are owned by the caller now.
    project = db_session.query(Project).filter_by(name=PROJECT_KEY, owner_id=user.id).one()
    assert project.provider_kind == "ado"

    config = db_session.query(ProjectConfig).filter_by(key=PROJECT_KEY, owner_id=user.id).one()
    assert config.base_url == "https://shared.surency.test"
    assert crypto.decrypt(config.test_accounts[0]["password"]) == "s3cret!"
    # The shared source row is untouched.
    shared_config = db_session.query(ProjectConfig).filter_by(key=PROJECT_KEY, owner_id=None).one()
    assert crypto.decrypt(shared_config.test_accounts[0]["password"]) == "s3cret!"

    knowledge = db_session.query(ProjectKnowledge).filter_by(key=PROJECT_KEY, owner_id=user.id).one()
    assert knowledge.confidence == 90
    assert f"users/{user.id}" in knowledge.doc_path.replace("\\", "/")

    # Files landed under the caller's own scope.
    dest_dir = scoped_knowledge_dir(user.id) / slug(PROJECT_KEY)
    assert (dest_dir / "knowledge.json").exists()
    assert (dest_dir / "knowledge.md").exists()
    # The shared source files are untouched.
    assert (scoped_knowledge_dir(None) / slug(PROJECT_KEY) / "knowledge.json").exists()


def test_clone_second_time_conflicts_409(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    _seed_shared_project(db_session)
    user = _make_user(db_session, "twice@example.com")
    headers = _auth_headers(user)

    first = client.post(f"/shared/projects/{PROJECT_KEY}/clone", headers=headers)
    assert first.status_code == 200

    second = client.post(f"/shared/projects/{PROJECT_KEY}/clone", headers=headers)
    assert second.status_code == 409


def test_clone_unbuilt_shared_project_422(client, db_session, monkeypatch):
    """A shared project with no indexed knowledge has nothing to reuse — block it."""
    _auth_on(monkeypatch)
    key = "Unbuilt Project"
    db_session.add(
        Project(provider_kind="ado", external_id="shared-nb", name=key, active=True, owner_id=None)
    )
    db_session.add(ProjectConfig(key=key, name=key, base_url="https://x.test", owner_id=None))
    db_session.add(
        ProjectKnowledge(key=key, project_key=key, name=key, status="not_indexed", owner_id=None)
    )
    db_session.commit()

    user = _make_user(db_session, "unbuilt@example.com")
    resp = client.post(f"/shared/projects/{key}/clone", headers=_auth_headers(user))
    assert resp.status_code == 422


def test_clone_missing_shared_project_404(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    user = _make_user(db_session, "ghost@example.com")
    headers = _auth_headers(user)

    resp = client.post("/shared/projects/Ghost Project/clone", headers=headers)
    assert resp.status_code == 404


def test_clone_does_not_expose_admins_connection_bindings(client, db_session, monkeypatch):
    """Provider-connection FKs are not copied — the destination owner can't see them."""
    _auth_on(monkeypatch)
    seeded = _seed_shared_project(db_session)
    seeded["config"].work_item_connection_id = 999
    seeded["config"].repository_connection_id = 998
    db_session.commit()

    user = _make_user(db_session, "conn@example.com")
    headers = _auth_headers(user)
    resp = client.post(f"/shared/projects/{PROJECT_KEY}/clone", headers=headers)
    assert resp.status_code == 200

    cloned = db_session.query(ProjectConfig).filter_by(key=PROJECT_KEY, owner_id=user.id).one()
    assert cloned.work_item_connection_id is None
    assert cloned.repository_connection_id is None


# --------------------------------------------------------- admin shared management
def test_non_admin_cannot_write_shared_namespace(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    member = _make_user(db_session, "notadmin@example.com", role="member")
    headers = _auth_headers(member)

    resp = client.post(f"/shared/projects/{PROJECT_KEY}", json={"baseUrl": "https://x.test"}, headers=headers)
    assert resp.status_code == 403

    resp = client.post(f"/shared/projects/{PROJECT_KEY}/knowledge/build", json={}, headers=headers)
    assert resp.status_code == 403


def test_admin_can_create_shared_project_shell_and_build_knowledge(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    admin = _make_user(db_session, "admin@example.com", role="admin")
    headers = _auth_headers(admin)

    resp = client.post(
        f"/shared/projects/{PROJECT_KEY}",
        json={
            "name": PROJECT_KEY,
            "providerKind": "ado",
            "externalId": "shared-2",
            "baseUrl": "https://shared.surency.test",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["baseUrl"] == "https://shared.surency.test"

    project = db_session.query(Project).filter_by(name=PROJECT_KEY, owner_id=None).one()
    assert project.provider_kind == "ado"
    config = db_session.query(ProjectConfig).filter_by(key=PROJECT_KEY, owner_id=None).one()
    assert config.base_url == "https://shared.surency.test"

    from tests.test_knowledge import _wait_idle

    monkeypatch.setattr(knowledge_service, "run_json", lambda *a, **k: {"confidence": 77, "stack": ["React"]})
    from app.services import repo_service

    monkeypatch.setattr(repo_service, "resolve_repo_path", lambda *a, **k: None)

    build_resp = client.post(
        f"/shared/projects/{PROJECT_KEY}/knowledge/build",
        json={"name": PROJECT_KEY, "provider": "ado"},
        headers=headers,
    )
    assert build_resp.status_code == 200
    _wait_idle(PROJECT_KEY)

    knowledge = db_session.query(ProjectKnowledge).filter_by(key=PROJECT_KEY, owner_id=None).one()
    assert knowledge.status == "indexed"
    assert knowledge.confidence == 77


def test_admin_configures_repo_and_config_round_trips(client, db_session, monkeypatch):
    """Admin can attach a repo + repository connection; catalog + config GET reflect it."""
    _auth_on(monkeypatch)
    admin = _make_user(db_session, "repoadmin@example.com", role="admin")
    headers = _auth_headers(admin)
    key = "Repo Project"

    resp = client.post(
        f"/shared/projects/{key}",
        json={
            "name": key,
            "baseUrl": "https://repo.test",
            "repositoryConnectionId": 42,
            "repos": [
                {"name": "web", "repoUrl": "https://git.test/web.git", "defaultBranch": "main"}
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 201

    # The shared config GET returns the repo + binding (passwords masked shape).
    cfg = client.get(f"/shared/projects/{key}/config", headers=headers).json()
    assert cfg["baseUrl"] == "https://repo.test"
    assert cfg["repositoryConnectionId"] == 42
    assert [r["name"] for r in cfg["repos"]] == ["web"]

    # The catalog also surfaces the repo so per-repo build buttons can render.
    entry = next(e for e in client.get("/shared/projects", headers=headers).json() if e["key"] == key)
    assert [r["name"] for r in entry["repos"]] == ["web"]
    assert entry["repositoryConnectionId"] == 42


def test_shared_auth_routes_are_admin_only(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    member = _make_user(db_session, "authmember@example.com", role="member")
    headers = _auth_headers(member)
    assert client.get(f"/shared/projects/{PROJECT_KEY}/config", headers=headers).status_code == 403
    assert client.get(f"/shared/projects/{PROJECT_KEY}/auth", headers=headers).status_code == 403


# ------------------------------------------------------------------------ catalog
def test_shared_catalog_lists_project_and_reflects_clone_state(client, db_session, monkeypatch):
    _auth_on(monkeypatch)
    _seed_shared_project(db_session)
    user = _make_user(db_session, "catalog@example.com")
    headers = _auth_headers(user)

    before = client.get("/shared/projects", headers=headers)
    assert before.status_code == 200
    entry = next(e for e in before.json() if e["key"] == PROJECT_KEY)
    assert entry["hasConfig"] is True
    assert entry["knowledge"][0]["confidence"] == 90
    assert entry["alreadyCloned"] is False

    client.post(f"/shared/projects/{PROJECT_KEY}/clone", headers=headers)

    after = client.get("/shared/projects", headers=headers)
    entry_after = next(e for e in after.json() if e["key"] == PROJECT_KEY)
    assert entry_after["alreadyCloned"] is True
