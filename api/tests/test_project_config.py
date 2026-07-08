"""Tests for Project Config: encrypted secrets, masking, and context injection."""

from __future__ import annotations

from app import crypto
from app.models.project_config import ProjectConfig
from app.models.provider_connection import ProviderConnection
from app.models.ticket import Ticket
from app.services import project_config_service


def test_save_config_masks_password_and_encrypts_at_rest(client, db_session):
    resp = client.put(
        "/projects/Surency Platform/config",
        json={
            "baseUrl": "https://staging.surency.test",
            "localRepoPath": "/tmp/does-not-exist",
            "testAccounts": [
                {"role": "Internal Admin", "username": "qa@surency.test",
                 "password": "s3cret!", "notes": "primary"}
            ],
            "environments": [{"name": "Staging", "baseUrl": "https://staging.surency.test", "notes": ""}],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    # Password is never returned; only a boolean flag.
    account = data["testAccounts"][0]
    assert account["hasPassword"] is True
    assert "password" not in account
    assert data["baseUrl"] == "https://staging.surency.test"

    # Stored ciphertext is encrypted, not plaintext.
    row = db_session.query(ProjectConfig).filter_by(key="Surency Platform").one()
    stored = row.test_accounts[0]["password"]
    assert stored != "s3cret!"
    assert crypto.is_encrypted(stored)
    assert crypto.decrypt(stored) == "s3cret!"


def test_blank_password_preserves_stored_secret(client, db_session):
    client.put(
        "/projects/P/config",
        json={"testAccounts": [{"role": "Admin", "username": "a@b.c", "password": "orig", "notes": ""}]},
    )
    # Re-save with a blank password (UI submitting the masked form).
    client.put(
        "/projects/P/config",
        json={"testAccounts": [{"role": "Admin", "username": "a@b.c", "password": "", "notes": "edited"}]},
    )
    row = db_session.query(ProjectConfig).filter_by(key="P").one()
    assert crypto.decrypt(row.test_accounts[0]["password"]) == "orig"
    assert row.test_accounts[0]["notes"] == "edited"


def test_get_config_defaults_when_absent(client):
    data = client.get("/projects/Nope/config").json()
    assert data["key"] == "Nope"
    assert data["testAccounts"] == []
    assert data["baseUrl"] == ""
    assert data["manualAuth"] is False


def test_manual_auth_round_trips_via_config(client, db_session):
    resp = client.put("/projects/P/config", json={"manualAuth": True})
    assert resp.status_code == 200
    assert resp.json()["manualAuth"] is True

    row = db_session.query(ProjectConfig).filter_by(key="P").one()
    assert row.manual_auth is True

    # And it survives a read-back / can be toggled off.
    assert client.get("/projects/P/config").json()["manualAuth"] is True
    assert client.put("/projects/P/config", json={"manualAuth": False}).json()["manualAuth"] is False


def test_auth_state_reflects_session_file_and_delete_removes_it(client, app_env):
    key = "Surency Platform"
    # No session yet.
    state = client.get(f"/projects/{key}/auth").json()
    assert state["exists"] is False
    assert state["capturedAt"] is None

    # Create the saved session file where the service expects it.
    path = project_config_service.auth_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"cookies": []}', encoding="utf-8")

    state = client.get(f"/projects/{key}/auth").json()
    assert state["exists"] is True
    assert state["capturedAt"] is not None

    # DELETE removes it and returns the now-empty state.
    deleted = client.delete(f"/projects/{key}/auth").json()
    assert deleted["exists"] is False
    assert not path.exists()


def test_capture_auth_requires_base_url(client, app_env):
    resp = client.post("/projects/NoUrl/auth/capture")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Set a base URL for the project first."


def test_capture_auth_runs_in_background_and_saves_session(client, app_env, monkeypatch):
    import time

    from app.services import playwright_runner

    key = "Surency Platform"
    client.put(f"/projects/{key}/config", json={"baseUrl": "https://staging.surency.test"})

    # Stand in for the real headed-browser capture: write a dummy storageState.
    def _fake_capture(base_url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text('{"cookies": []}', encoding="utf-8")
        return True

    monkeypatch.setattr(playwright_runner, "capture_storage_state", _fake_capture)

    resp = client.post(f"/projects/{key}/auth/capture")
    assert resp.status_code == 200
    assert resp.json()["capturing"] is True

    # Poll until the background thread finishes.
    for _ in range(100):
        if not playwright_runner.is_capturing(key):
            break
        time.sleep(0.05)

    state = client.get(f"/projects/{key}/auth").json()
    assert state["capturing"] is False
    assert state["exists"] is True


def test_build_context_resolves_via_connection_and_decrypts(db_session):
    conn = ProviderConnection(kind="ado", name="ADO", connected=True,
                              config={"project": "Surency Platform"}, secrets={})
    db_session.add(conn)
    db_session.flush()
    db_session.add(
        ProjectConfig(
            key="Surency Platform", name="Surency Platform",
            base_url="https://app.test",
            environments=[{"name": "Staging", "base_url": "https://staging.test", "notes": ""}],
            test_accounts=[{"role": "Admin", "username": "u", "password": crypto.encrypt("pw"), "notes": ""}],
        )
    )
    ticket = Ticket(external_id="SUR-1", provider_kind="ado", title="t", connection_id=conn.id)
    db_session.add(ticket)
    db_session.commit()

    ctx = project_config_service.build_context(db_session, ticket, env="Staging")
    assert ctx["projectKey"] == "Surency Platform"
    # Per-environment URL wins when the run env matches.
    assert ctx["baseUrl"] == "https://staging.test"
    # Passwords are decrypted for the generator (never over the API).
    assert ctx["testAccounts"][0]["password"] == "pw"


def test_spec_prompt_bakes_real_values_when_context_present(db_session, monkeypatch):
    from app.services import spec_service
    from app.models.testcase import TestCase

    context = {
        "projectKey": "P",
        "baseUrl": "https://app.test",
        "testAccounts": [{"role": "Admin", "username": "qa@app.test", "password": "pw123"}],
        "routes": [{"path": "/groups", "description": "Groups list"}],
    }
    case = TestCase(
        run_id=1, ticket_external_id="SUR-1", code="TC-01",
        title="Open groups", precondition="Logged in as Admin",
        steps=[{"a": "Go to groups", "e": "List shows"}],
    )
    prompt = spec_service._build_prompt(case, context)
    assert "https://app.test" in prompt
    assert "qa@app.test" in prompt
    assert "pw123" in prompt  # literal credentials, per the product decision
    assert "/groups" in prompt
    # The old "use placeholders" instruction is gone when context is present.
    assert "reasonable placeholders" not in prompt
