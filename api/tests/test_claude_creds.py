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
    assert body == {"hasOwn": False, "hasShared": False, "mode": "none"}


def test_upload_and_delete_own_credentials(client, db_session):
    _make_user(db_session, "own@example.com", "password123")
    token = _login(client, "own@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials", json={"credentials": OWN_JSON}, headers=headers)
    assert r.status_code == 200
    assert "own-secret-token" not in r.text  # never echoes the plaintext token back

    status = client.get("/ai/credentials", headers=headers).json()
    assert status == {"hasOwn": True, "hasShared": False, "mode": "own"}

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


def test_admin_can_manage_shared_credentials(client, db_session):
    _make_user(db_session, "admin@example.com", "password123", role="admin")
    token = _login(client, "admin@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put("/ai/credentials/shared", json={"credentials": SHARED_JSON}, headers=headers)
    assert r.status_code == 200
    assert "shared-secret-token" not in r.text

    status = client.get("/ai/credentials", headers=headers).json()
    assert status == {"hasOwn": False, "hasShared": True, "mode": "shared"}

    r = client.delete("/ai/credentials/shared", headers=headers)
    assert r.status_code == 200
    status = client.get("/ai/credentials", headers=headers).json()
    assert status["hasShared"] is False
