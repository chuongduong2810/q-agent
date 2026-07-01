"""API tests for /providers and /settings endpoints."""

from __future__ import annotations

import httpx
import respx


def test_list_providers_empty(client):
    resp = client.get("/providers")
    assert resp.status_code == 200
    assert resp.json() == []


def test_put_provider_encrypts_secrets_and_never_returns_plaintext(client, db_session):
    resp = client.put(
        "/providers/ado",
        json={
            "config": {"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
            "secrets": {"pat": "super-secret-pat-value"},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "ado"
    assert body["config"] == {"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"}
    assert body["secretFields"] == ["pat"]
    # plaintext secret must never appear anywhere in the response
    assert "super-secret-pat-value" not in resp.text

    # Confirm it's actually encrypted at rest in the DB, not stored plaintext.
    from app.models.provider import Provider

    provider = db_session.query(Provider).filter(Provider.kind == "ado").first()
    assert provider is not None
    assert provider.secrets["pat"] != "super-secret-pat-value"
    assert provider.secrets["pat"].startswith("enc::")


def test_get_provider_after_put(client):
    client.put(
        "/providers/jira",
        json={
            "config": {"baseUrl": "https://myorg.atlassian.net"},
            "secrets": {"email": "qa@myorg.com", "apiToken": "tok-123"},
        },
    )
    resp = client.get("/providers/jira")
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "jira"
    assert sorted(body["secretFields"]) == ["apiToken", "email"]
    assert "tok-123" not in resp.text


def test_get_unknown_provider_kind_404(client):
    resp = client.get("/providers/bogus")
    assert resp.status_code == 404


def test_get_provider_not_configured_404(client):
    resp = client.get("/providers/github")
    assert resp.status_code == 404


@respx.mock
def test_provider_test_connection_ok(client):
    client.put(
        "/providers/github",
        json={"config": {"org": "acme", "repo": "webapp"}, "secrets": {"pat": "ghp_xxx"}},
    )
    respx.get("https://api.github.com/user").mock(
        return_value=httpx.Response(200, json={"login": "duna"})
    )

    resp = client.post("/providers/github/test")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True

    # connected flag should now be persisted true
    resp2 = client.get("/providers/github")
    assert resp2.json()["connected"] is True


def test_provider_test_connection_not_configured_404(client):
    resp = client.post("/providers/ado/test")
    assert resp.status_code == 404


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
