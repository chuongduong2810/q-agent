"""Tests for the auth vertical (ADR 0007) — guard, login, refresh, roles, WS.

The global guard defaults OFF; these tests flip it on via the ``auth_on`` fixture
and verify the flag default doesn't disturb existing behavior.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def auth_on(monkeypatch):
    """Turn the global auth guard on for the duration of a test."""
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)
    yield


def _make_user(db_session, email, password, role="member", active=True):
    from app.models.user import User
    from app.services import auth_service

    user = User(
        email=email.strip().lower(),
        first_name="Test",
        last_name="User",
        role=role,
        password_hash=auth_service.hash_password(password),
        is_active=active,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client, email, password, remember=False):
    return client.post("/auth/login", json={"email": email, "password": password, "remember": remember})


# ---------------------------------------------------------------- guard
def test_guard_off_by_default_allows_tokenless(client):
    """With the flag off (default) protected routes stay open — no regression."""
    assert client.get("/audit/stats").status_code == 200


def test_guard_on_rejects_tokenless(client, auth_on):
    assert client.get("/audit/stats").status_code == 401
    # Health + login remain allowlisted.
    assert client.get("/health").status_code == 200


def test_guard_on_allows_valid_bearer(client, auth_on, db_session):
    _make_user(db_session, "member@example.com", "hunter2000")
    token = _login(client, "member@example.com", "hunter2000").json()["accessToken"]
    r = client.get("/audit/stats", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


# ---------------------------------------------------------------- login
def test_login_returns_token_and_sets_cookies(client, db_session):
    _make_user(db_session, "admin@example.com", "supersecret1")
    r = _login(client, "admin@example.com", "supersecret1", remember=True)
    assert r.status_code == 200
    body = r.json()
    assert body["accessToken"]
    assert body["user"]["email"] == "admin@example.com"
    assert body["mfaRequired"] is False
    # Cookies set (HttpOnly refresh on /auth, readable csrf on /).
    assert client.cookies.get("qagent_refresh")
    assert client.cookies.get("qagent_csrf")


def test_login_bad_password_401(client, db_session):
    _make_user(db_session, "x@example.com", "correcthorse")
    assert _login(client, "x@example.com", "wrong").status_code == 401


def test_inactive_user_cannot_login(client, db_session):
    _make_user(db_session, "off@example.com", "password123", active=False)
    assert _login(client, "off@example.com", "password123").status_code == 401


# ---------------------------------------------------------------- me
def test_me_with_bearer(client, db_session):
    _make_user(db_session, "me@example.com", "password123", role="member")
    token = _login(client, "me@example.com", "password123").json()["accessToken"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "me@example.com"
    # No bearer → 401 regardless of the global flag.
    assert client.get("/auth/me").status_code == 401


# ---------------------------------------------------------------- refresh
def test_refresh_rotates(client, db_session):
    _make_user(db_session, "rot@example.com", "password123")
    login = _login(client, "rot@example.com", "password123").json()
    first_access = login["accessToken"]
    refresh_before = client.cookies.get("qagent_refresh")
    csrf = client.cookies.get("qagent_csrf")

    r = client.post("/auth/refresh", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    body = r.json()
    assert body["accessToken"]
    assert body["user"]["email"] == "rot@example.com"
    # The opaque refresh token was rotated (cookie value changed).
    assert client.cookies.get("qagent_refresh") != refresh_before

    # Missing CSRF header → 403.
    assert client.post("/auth/refresh").status_code == 403


# ---------------------------------------------------------------- roles
def test_member_forbidden_on_admin_route(client, db_session):
    _make_user(db_session, "member2@example.com", "password123", role="member")
    token = _login(client, "member2@example.com", "password123").json()["accessToken"]
    r = client.get("/auth/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_admin_can_list_and_create_users(client, db_session):
    _make_user(db_session, "boss@example.com", "password123", role="admin")
    token = _login(client, "boss@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/auth/users", headers=headers).status_code == 200

    created = client.post(
        "/auth/users",
        headers=headers,
        json={"email": "New@Example.com", "firstName": "N", "lastName": "U", "role": "member", "password": "password123"},
    )
    assert created.status_code == 201
    assert created.json()["email"] == "new@example.com"  # lowercased


# ---------------------------------------------------------------- change password
def test_change_password(client, db_session):
    _make_user(db_session, "pw@example.com", "oldpassword1")
    token = _login(client, "pw@example.com", "oldpassword1").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    bad = client.post("/auth/change-password", headers=headers, json={"currentPassword": "nope", "newPassword": "newpassword1"})
    assert bad.status_code == 400

    ok = client.post("/auth/change-password", headers=headers, json={"currentPassword": "oldpassword1", "newPassword": "newpassword1"})
    assert ok.status_code == 200
    # Old password no longer works.
    assert _login(client, "pw@example.com", "oldpassword1").status_code == 401
    assert _login(client, "pw@example.com", "newpassword1").status_code == 200


# ---------------------------------------------------------------- 2FA + MFA login
def test_2fa_setup_enable_and_mfa_login(client, db_session):
    import pyotp

    _make_user(db_session, "mfa@example.com", "password123")
    token = _login(client, "mfa@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    setup = client.post("/auth/2fa/setup", headers=headers).json()
    secret = setup["secret"]
    assert setup["otpauthUri"].startswith("otpauth://")

    code = pyotp.TOTP(secret).now()
    assert client.post("/auth/2fa/enable", headers=headers, json={"code": code}).status_code == 200

    # Now login returns an MFA challenge instead of an access token.
    challenge = _login(client, "mfa@example.com", "password123").json()
    assert challenge["mfaRequired"] is True and challenge["mfaToken"]

    code2 = pyotp.TOTP(secret).now()
    done = client.post("/auth/login/mfa", json={"mfaToken": challenge["mfaToken"], "code": code2})
    assert done.status_code == 200
    assert done.json()["accessToken"]


# ---------------------------------------------------------------- sessions
def test_sessions_list_flags_current(client, db_session):
    _make_user(db_session, "sess@example.com", "password123")
    token = _login(client, "sess@example.com", "password123").json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    sessions = client.get("/auth/sessions", headers=headers).json()
    assert len(sessions) == 1
    assert sessions[0]["current"] is True
    assert set(sessions[0].keys()) >= {"id", "userAgent", "ip", "current"}


# ---------------------------------------------------------------- password reset (dev stub)
def test_request_and_perform_reset(client, db_session):
    _make_user(db_session, "reset@example.com", "oldpassword1")
    req = client.post("/auth/request-reset", json={"email": "reset@example.com"})
    assert req.status_code == 200
    reset_token = req.json()["token"]  # echoed in non-prod (cookie_secure False)
    assert reset_token

    done = client.post("/auth/reset", json={"token": reset_token, "password": "brandnewpw1"})
    assert done.status_code == 200
    assert _login(client, "reset@example.com", "brandnewpw1").status_code == 200


# ---------------------------------------------------------------- WS + artifacts guard
def test_ws_rejects_missing_token_when_auth_on(client, auth_on):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/ai"):
            pass


def test_artifacts_rejects_missing_token_when_auth_on(client, auth_on):
    assert client.get("/artifacts/anything.png").status_code == 401
