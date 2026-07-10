"""API tests for /providers (grouped catalog) + /connections CRUD/test + /settings."""

from __future__ import annotations

import httpx
import respx


def _create(client, kind: str, name: str = "") -> dict:
    resp = client.post(f"/providers/{kind}/connections", json={"name": name or kind})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_list_providers_grouped_and_empty(client):
    resp = client.get("/providers")
    assert resp.status_code == 200
    groups = resp.json()
    # One group per kind, fixed order.
    kinds = [g["kind"] for g in groups]
    assert kinds == ["ado", "jira", "github"]
    categories = {g["kind"]: g["categories"] for g in groups}
    assert categories == {
        "ado": ["work_item", "repository"],
        "jira": ["work_item"],
        "github": ["repository"],
    }
    assert all(g["connectionCount"] == 0 for g in groups)
    assert all(g["connections"] == [] for g in groups)


def test_create_connection_and_group_counts(client):
    conn = _create(client, "ado", "Prod ADO")
    assert conn["kind"] == "ado"
    assert conn["categories"] == ["work_item", "repository"]
    assert conn["name"] == "Prod ADO"
    assert conn["connected"] is False

    groups = {g["kind"]: g for g in client.get("/providers").json()}
    assert groups["ado"]["connectionCount"] == 1
    assert groups["ado"]["connectedCount"] == 0
    assert groups["ado"]["connections"][0]["id"] == conn["id"]


def test_create_connection_unknown_kind_404(client):
    resp = client.post("/providers/bogus/connections", json={"name": "x"})
    assert resp.status_code == 404


def test_multiple_connections_of_one_kind(client):
    a = _create(client, "ado", "ADO One")
    b = _create(client, "ado", "ADO Two")
    assert a["id"] != b["id"]
    group = {g["kind"]: g for g in client.get("/providers").json()}["ado"]
    assert group["connectionCount"] == 2
    assert {c["name"] for c in group["connections"]} == {"ADO One", "ADO Two"}


def test_update_connection_encrypts_secrets_and_never_returns_plaintext(client, db_session):
    conn = _create(client, "ado")
    resp = client.put(
        f"/connections/{conn['id']}",
        json={
            "config": {"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
            "secrets": {"pat": "super-secret-pat-value"},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["config"] == {"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"}
    assert body["secretFields"] == ["pat"]
    assert "super-secret-pat-value" not in resp.text

    from app.models.provider_connection import ProviderConnection

    row = db_session.get(ProviderConnection, conn["id"])
    assert row.secrets["pat"] != "super-secret-pat-value"
    assert row.secrets["pat"].startswith("enc::")


def test_update_connection_preserves_untouched_secrets(client, db_session):
    conn = _create(client, "jira")
    client.put(f"/connections/{conn['id']}", json={"secrets": {"apiToken": "tok-123"}})
    # A later config-only PUT must not blank the stored secret.
    client.put(f"/connections/{conn['id']}", json={"config": {"baseUrl": "https://x.atlassian.net"}})

    from app.models.provider_connection import ProviderConnection

    row = db_session.get(ProviderConnection, conn["id"])
    assert row.secrets["apiToken"].startswith("enc::")
    assert row.config["baseUrl"] == "https://x.atlassian.net"


def test_update_unknown_connection_404(client):
    resp = client.put("/connections/9999", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_connection_nulls_referencing_fks(client, db_session):
    from app.models.project_config import ProjectConfig
    from app.models.ticket import Ticket

    conn = _create(client, "ado")
    db_session.add(Ticket(external_id="T-1", provider_kind="ado", title="t", connection_id=conn["id"]))
    db_session.add(ProjectConfig(key="P", name="P", work_item_connection_id=conn["id"]))
    db_session.commit()

    resp = client.delete(f"/connections/{conn['id']}")
    assert resp.status_code == 204

    db_session.expire_all()
    assert db_session.query(Ticket).filter(Ticket.external_id == "T-1").first().connection_id is None
    cfg = db_session.query(ProjectConfig).filter(ProjectConfig.key == "P").first()
    assert cfg.work_item_connection_id is None


@respx.mock
def test_connection_test_sets_connected_and_last_tested(client):
    conn = _create(client, "github")
    client.put(
        f"/connections/{conn['id']}",
        json={"config": {"org": "acme", "repo": "webapp"}, "secrets": {"pat": "ghp_xxx"}},
    )
    respx.get("https://api.github.com/user").mock(
        return_value=httpx.Response(200, json={"login": "duna"})
    )

    resp = client.post(f"/connections/{conn['id']}/test")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    group = {g["kind"]: g for g in client.get("/providers").json()}["github"]
    c = group["connections"][0]
    assert c["connected"] is True
    assert c["lastTestedAt"] is not None


def test_connection_test_unknown_404(client):
    assert client.post("/connections/9999/test").status_code == 404


def test_repos_endpoint_rejects_work_item_only_connection(client):
    conn = _create(client, "jira")
    # /repos is a repository-capability route; Jira has no repository capability.
    assert client.get(f"/connections/{conn['id']}/repos").status_code == 400


def test_repos_endpoint_accepts_ado_connection(client):
    # ADO is dual-capability, so the repository routes accept it too.
    conn = _create(client, "ado")
    resp = client.get(f"/connections/{conn['id']}/repos")
    assert resp.status_code == 200
    # The picker consumes the {provider, repos, error} wrapper (matching the
    # TypeScript AvailableReposOut), not a bare list — a bare list left the UI
    # reading `.repos` off an array and silently showing nothing.
    body = resp.json()
    assert isinstance(body, dict)
    assert isinstance(body["repos"], list)
    assert "error" in body and "provider" in body


def test_sprints_endpoint_rejects_repository_only_connection(client):
    conn = _create(client, "github")
    assert client.get(f"/connections/{conn['id']}/sprints").status_code == 400


def test_settings_default_and_update(client):
    resp = client.get("/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["parallel"] == 4
    assert body["retryFlaky"] is True

    resp2 = client.put("/settings", json={"parallel": 8, "video": True})
    assert resp2.status_code == 200
    updated = resp2.json()
    assert updated["parallel"] == 8
    assert updated["video"] is True
    assert updated["retryFlaky"] is True  # unchanged

    resp3 = client.get("/settings")
    assert resp3.json()["parallel"] == 8
