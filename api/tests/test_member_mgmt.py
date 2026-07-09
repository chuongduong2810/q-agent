"""Tests for member management (#94) — RBAC + admin lifecycle + self-service.

Mirrors ``test_auth.py``'s style (local ``auth_on`` fixture + ``_make_user``
helper) since the global guard defaults off and this vertical only matters
with it on.
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


def _login(client, email, password):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["accessToken"]


def _admin_headers(client, db_session, email="boss@example.com", password="password123"):
    _make_user(db_session, email, password, role="admin")
    token = _login(client, email, password)
    return {"Authorization": f"Bearer {token}"}


def _member_headers(client, db_session, email="rank@example.com", password="password123"):
    _make_user(db_session, email, password, role="member")
    token = _login(client, email, password)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------- invite
def test_admin_can_invite_change_role_deactivate_remove(client, db_session, auth_on):
    headers = _admin_headers(client, db_session)

    invited = client.post(
        "/auth/users/invite",
        headers=headers,
        json={"email": "New@Example.com", "firstName": "N", "lastName": "U", "role": "member"},
    )
    assert invited.status_code == 201, invited.text
    body = invited.json()
    assert body["user"]["email"] == "new@example.com"  # lowercased
    assert body["user"]["role"] == "member"
    reset_token = body["resetToken"]
    assert reset_token  # echoed in non-prod (cookie_secure False)

    # The invited user has no usable password until they redeem the token.
    assert client.post("/auth/login", json={"email": "new@example.com", "password": ""}).status_code == 401
    done = client.post("/auth/reset", json={"token": reset_token, "password": "brandnewpw1"})
    assert done.status_code == 200
    assert client.post("/auth/login", json={"email": "new@example.com", "password": "brandnewpw1"}).status_code == 200

    user_id = body["user"]["id"]

    # Change role admin<->member.
    promoted = client.patch(f"/auth/users/{user_id}", headers=headers, json={"role": "admin"})
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"

    # Deactivate / reactivate.
    deactivated = client.patch(f"/auth/users/{user_id}", headers=headers, json={"isActive": False})
    assert deactivated.status_code == 200
    assert deactivated.json()["isActive"] is False
    reactivated = client.patch(f"/auth/users/{user_id}", headers=headers, json={"isActive": True})
    assert reactivated.status_code == 200
    assert reactivated.json()["isActive"] is True

    # Remove.
    removed = client.delete(f"/auth/users/{user_id}", headers=headers)
    assert removed.status_code == 200
    remaining_ids = {u["id"] for u in client.get("/auth/users", headers=headers).json()}
    assert user_id not in remaining_ids


def test_invite_duplicate_email_conflicts(client, db_session, auth_on):
    headers = _admin_headers(client, db_session)
    _make_user(db_session, "dupe@example.com", "password123")
    r = client.post("/auth/users/invite", headers=headers, json={"email": "dupe@example.com"})
    assert r.status_code == 409


# ---------------------------------------------------------------- RBAC (403)
@pytest.mark.parametrize(
    ("method", "path", "json_body"),
    [
        ("GET", "/auth/users", None),
        ("POST", "/auth/users/invite", {"email": "x@example.com"}),
        ("POST", "/auth/users", {"email": "x@example.com", "password": "password123"}),
        ("PATCH", "/auth/users/1", {"role": "admin"}),
        ("DELETE", "/auth/users/1", None),
    ],
)
def test_member_forbidden_on_admin_endpoints(client, db_session, auth_on, method, path, json_body):
    headers = _member_headers(client, db_session)
    r = client.request(method, path, headers=headers, json=json_body)
    assert r.status_code == 403


# ---------------------------------------------------------------- self-service scoping
def test_member_cannot_modify_another_users_profile(client, db_session, auth_on):
    """Self-service endpoints only ever act on the bearer's own account — a
    member has no way to address another user's id."""
    other = _make_user(db_session, "victim@example.com", "password123", role="member")
    headers = _member_headers(client, db_session, email="attacker@example.com")

    # /auth/me has no id param — PATCH only ever updates the bearer's own row.
    r = client.patch("/auth/me", headers=headers, json={"firstName": "Hacked"})
    assert r.status_code == 200
    db_session.refresh(other)
    assert other.first_name != "Hacked"  # the other user's row is untouched

    # Sessions are ownership-scoped: a member can't revoke another user's session.
    other_token = _login(client, "victim@example.com", "password123")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_sessions = client.get("/auth/sessions", headers=other_headers).json()
    other_session_id = other_sessions[0]["id"]
    assert client.delete(f"/auth/sessions/{other_session_id}", headers=headers).status_code == 404


# ---------------------------------------------------------------- last-admin lockout
def test_cannot_deactivate_the_last_active_admin(client, db_session, auth_on):
    headers = _admin_headers(client, db_session, email="solo@example.com")
    me = client.get("/auth/me", headers=headers).json()

    r = client.patch(f"/auth/users/{me['id']}", headers=headers, json={"isActive": False})
    assert r.status_code == 400

    r2 = client.patch(f"/auth/users/{me['id']}", headers=headers, json={"role": "member"})
    assert r2.status_code == 400


def test_cannot_remove_the_last_active_admin(client, db_session, auth_on):
    headers = _admin_headers(client, db_session, email="solo2@example.com")
    me = client.get("/auth/me", headers=headers).json()

    r = client.delete(f"/auth/users/{me['id']}", headers=headers)
    assert r.status_code == 400


def test_can_deactivate_an_admin_when_another_stays_active(client, db_session, auth_on):
    headers = _admin_headers(client, db_session, email="admin1@example.com")
    other_admin = _make_user(db_session, "admin2@example.com", "password123", role="admin")

    r = client.patch(f"/auth/users/{other_admin.id}", headers=headers, json={"isActive": False})
    assert r.status_code == 200
    assert r.json()["isActive"] is False
