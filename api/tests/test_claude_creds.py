"""Tests for Claude CLI credentials management + per-user cost attribution (#95).

Covers: effective-credential resolution (own > shared > none), that
``CLAUDE_CONFIG_DIR`` is set to the right per-user/shared dir in the actual
``claude_cli.run_prompt`` invocation (subprocess mocked), that missing
credentials raise a clean :class:`ClaudeError`, that usage rows are stamped
with the right ``owner_id``, and the HTTP surface (status/upload/delete,
admin-only shared). Never asserts on plaintext tokens in responses.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.services import claude_cli, claude_credentials

OWN_JSON = '{"token": "own-secret-token"}'
SHARED_JSON = '{"token": "shared-secret-token"}'


def _make_user(db_session, email, password, role="member"):
    from app.models.user import User
    from app.services import auth_service

    user = User(
        email=email.strip().lower(),
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


def _login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password})


def _fake_subprocess_run(returncode=0, result="ok", usage=None):
    envelope = {"result": result}
    if usage is not None:
        envelope["usage"] = usage
        envelope["total_cost_usd"] = 0.01
    return lambda *a, **k: SimpleNamespace(
        returncode=returncode, stdout=json.dumps(envelope), stderr=""
    )


# ------------------------------------------------------------- metadata parsing
RICH_JSON = json.dumps(
    {
        "claudeAiOauth": {
            "accessToken": "secret-access",
            "refreshToken": "secret-refresh",
            "expiresAt": 1780000000000,  # epoch ms
            "scopes": ["user:inference", "user:profile"],
            "subscriptionType": "max",
        }
    }
)


def test_upsert_extracts_metadata_from_nested_oauth_object(db_session):
    from datetime import datetime, timezone

    row = claude_credentials.upsert_own(db_session, 1, RICH_JSON)

    assert row.expires_at == datetime.fromtimestamp(1780000000000 / 1000, tz=timezone.utc)
    assert row.scopes == ["user:inference", "user:profile"]
    assert row.subscription_type == "max"


def test_upsert_extracts_metadata_from_top_level_fallback(db_session):
    """No ``claudeAiOauth`` wrapper — falls back to top-level keys."""
    flat_json = json.dumps({"expiresAt": 1780000000000, "scopes": ["user:inference"], "subscriptionType": "pro"})

    row = claude_credentials.upsert_shared(db_session, flat_json)

    assert row.expires_at is not None
    assert row.scopes == ["user:inference"]
    assert row.subscription_type == "pro"


def test_upsert_metadata_missing_yields_null_not_error(db_session):
    """No metadata present at all -> every extracted field is None, no raise."""
    row = claude_credentials.upsert_own(db_session, 2, OWN_JSON)

    assert row.expires_at is None
    assert row.scopes is None
    assert row.subscription_type is None


def test_upsert_metadata_ignores_malformed_types(db_session):
    """Wrong-typed fields (not a number/list/str) are defensively dropped, not raised."""
    weird_json = json.dumps(
        {"claudeAiOauth": {"expiresAt": "not-a-number", "scopes": "not-a-list", "subscriptionType": 42}}
    )

    row = claude_credentials.upsert_own(db_session, 3, weird_json)

    assert row.expires_at is None
    assert row.scopes is None
    assert row.subscription_type is None


# ------------------------------------------------------- resolution precedence
def test_resolve_effective_prefers_own_over_shared(db_session):
    claude_credentials.upsert_own(db_session, 1, OWN_JSON)
    claude_credentials.upsert_shared(db_session, SHARED_JSON)

    config_dir = claude_credentials.resolve_effective_config_dir(db_session, 1)

    assert config_dir is not None
    assert config_dir.name == "1"
    stored = (config_dir / ".credentials.json").read_text(encoding="utf-8")
    assert stored == OWN_JSON


def test_resolve_effective_falls_back_to_shared(db_session):
    claude_credentials.upsert_shared(db_session, SHARED_JSON)

    config_dir = claude_credentials.resolve_effective_config_dir(db_session, 42)

    assert config_dir is not None
    assert config_dir.name == "shared"
    stored = (config_dir / ".credentials.json").read_text(encoding="utf-8")
    assert stored == SHARED_JSON


def test_resolve_effective_none_when_nothing_configured(db_session):
    assert claude_credentials.resolve_effective_config_dir(db_session, 7) is None


# ------------------------------------------------------------- claude_cli wiring
def test_missing_credentials_raises_clean_error(monkeypatch, workspace_dir):
    """No own/shared credential at all -> ClaudeError, subprocess never invoked."""
    called = []
    monkeypatch.setattr(claude_cli.subprocess, "run", lambda *a, **k: called.append(1))

    with pytest.raises(claude_cli.ClaudeError, match="No Claude credentials configured"):
        claude_cli.run_prompt("hi", label="Test call")

    assert called == []  # never reached the subprocess


def test_run_prompt_sets_claude_config_dir_for_own_credential(monkeypatch, db_session):
    """An ambient run owned by user 5 -> CLAUDE_CONFIG_DIR points at that user's dir."""
    from app.models.run import Run
    from app.services import run_context

    claude_credentials.upsert_own(db_session, 5, OWN_JSON)
    run = Run(code="RUN-500", name="test", owner_id=5)
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return SimpleNamespace(returncode=0, stdout=json.dumps({"result": "ok"}), stderr="")

    monkeypatch.setattr(claude_cli.subprocess, "run", fake_run)

    run_context.set_run(run.id)
    try:
        out = claude_cli.run_prompt("hi", label="Owned call")
    finally:
        run_context.clear()

    assert out == "ok"
    config_dir = captured["env"]["CLAUDE_CONFIG_DIR"]
    assert config_dir.replace("\\", "/").endswith("claude-config/5")


def test_run_prompt_falls_back_to_shared_config_dir(monkeypatch, shared_claude_credential):
    """No ambient run (no owner resolvable) -> falls back to the shared credential dir."""
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs.get("env")
        return SimpleNamespace(returncode=0, stdout=json.dumps({"result": "ok"}), stderr="")

    monkeypatch.setattr(claude_cli.subprocess, "run", fake_run)

    claude_cli.run_prompt("hi", label="Unowned call")

    config_dir = captured["env"]["CLAUDE_CONFIG_DIR"]
    assert config_dir.replace("\\", "/").endswith("claude-config/shared")


# --------------------------------------------------------------- usage attribution
def test_usage_records_under_the_right_owner(monkeypatch, db_session):
    from app.models.claude_usage import ClaudeUsage
    from app.models.run import Run
    from app.services import run_context

    claude_credentials.upsert_own(db_session, 9, OWN_JSON)
    run = Run(code="RUN-900", name="test", owner_id=9)
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    usage = {"input_tokens": 10, "output_tokens": 20}
    monkeypatch.setattr(claude_cli.subprocess, "run", _fake_subprocess_run(usage=usage))

    run_context.set_run(run.id)
    try:
        claude_cli.run_prompt("hi", label="Owned usage call")
    finally:
        run_context.clear()

    row = db_session.query(ClaudeUsage).filter(ClaudeUsage.action == "Owned usage call").first()
    assert row is not None
    assert row.owner_id == 9
    assert row.input_tokens == 10
    assert row.output_tokens == 20


def test_usage_records_with_no_owner_when_using_shared(monkeypatch, shared_claude_credential):
    from app.models.claude_usage import ClaudeUsage

    monkeypatch.setattr(claude_cli.subprocess, "run", _fake_subprocess_run(usage={"input_tokens": 1}))

    claude_cli.run_prompt("hi", label="Shared usage call")

    row = (
        shared_claude_credential.query(ClaudeUsage)
        .filter(ClaudeUsage.action == "Shared usage call")
        .first()
    )
    assert row is not None
    assert row.owner_id is None


# ------------------------------------------------------------------------- HTTP
def test_status_reports_none_when_unconfigured(client, db_session):
    r = client.get("/ai/credentials")
    assert r.status_code == 200
    body = r.json()
    assert body == {"hasOwn": False, "hasShared": False, "mode": "none", "own": None, "shared": None}


def test_upload_and_delete_own_credentials(client, db_session):
    _make_user(db_session, "own@example.com", "password123")
    token = _login(client, "own@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials", json={"credentials": OWN_JSON}, headers=headers)
    assert r.status_code == 200
    assert "own-secret-token" not in r.text  # never echoes the plaintext token back

    status = client.get("/ai/credentials", headers=headers).json()
    assert status["hasOwn"] is True
    assert status["hasShared"] is False
    assert status["mode"] == "own"
    assert status["own"] == {
        "subscriptionType": None,
        "expiresAt": None,
        "scopes": [],
        "lastRefreshed": status["own"]["lastRefreshed"],
        "assignedUsers": None,
    }
    assert status["shared"] is None

    r = client.delete("/ai/credentials", headers=headers)
    assert r.status_code == 200

    status = client.get("/ai/credentials", headers=headers).json()
    assert status["hasOwn"] is False


def test_upload_own_rejects_malformed_json(client, db_session):
    _make_user(db_session, "bad@example.com", "password123")
    token = _login(client, "bad@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials", json={"credentials": "not json"}, headers=headers)
    assert r.status_code == 400


def test_shared_credentials_require_admin(client, db_session):
    _make_user(db_session, "member@example.com", "password123", role="member")
    token = _login(client, "member@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials/shared", json={"credentials": SHARED_JSON}, headers=headers)
    assert r.status_code == 403


def test_admin_user_list_reports_credential_source(client, db_session):
    """#95: ``GET /auth/users`` reports each user's effective credential
    source — "personal" (own upload), "shared" (falls back to the shared
    credential), or "none" (nothing resolves for them)."""
    admin = _make_user(db_session, "admin2@example.com", "password123", role="admin")
    personal_user = _make_user(db_session, "personal@example.com", "password123")
    fallback_user = _make_user(db_session, "fallback@example.com", "password123")

    claude_credentials.upsert_own(db_session, personal_user.id, OWN_JSON)
    claude_credentials.upsert_shared(db_session, SHARED_JSON)

    token = _login(client, "admin2@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    by_email = {u["email"]: u for u in client.get("/auth/users", headers=headers).json()}
    assert by_email["personal@example.com"]["credentialSource"] == "personal"
    assert by_email["fallback@example.com"]["credentialSource"] == "shared"
    assert by_email["admin2@example.com"]["credentialSource"] == "shared"


def test_admin_user_list_reports_no_credential_source_when_nothing_configured(client, db_session):
    _make_user(db_session, "admin3@example.com", "password123", role="admin")
    token = _login(client, "admin3@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    users = client.get("/auth/users", headers=headers).json()
    assert all(u["credentialSource"] == "none" for u in users)


def test_admin_can_manage_shared_credentials(client, db_session):
    _make_user(db_session, "admin@example.com", "password123", role="admin")
    token = _login(client, "admin@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials/shared", json={"credentials": SHARED_JSON}, headers=headers)
    assert r.status_code == 200
    assert "shared-secret-token" not in r.text

    status = client.get("/ai/credentials", headers=headers).json()
    assert status["hasOwn"] is False
    assert status["hasShared"] is True
    assert status["mode"] == "shared"
    assert status["own"] is None
    # The one admin user has no own credential, so it falls back to shared.
    assert status["shared"]["assignedUsers"] == 1

    r = client.delete("/ai/credentials/shared", headers=headers)
    assert r.status_code == 200
    status = client.get("/ai/credentials", headers=headers).json()
    assert status["hasShared"] is False
