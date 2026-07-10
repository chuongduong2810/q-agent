"""Tests for Local Agent device pairing + authentication (Local Agent feature).

Covers the full pair -> redeem -> authenticate -> revoke lifecycle at the
service layer (``app.services.agent_device_service``), including that only the
token's hash is ever persisted, expired/invalid pairing codes are rejected, and
revoked/other-users' devices are excluded from lookups.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.services import agent_device_service, auth_service


def _make_user(db_session, email: str):
    from app.models.user import User

    user = User(
        email=email,
        first_name="Agent",
        last_name="Owner",
        password_hash=auth_service.hash_password("password123"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_pair_redeem_authenticate_revoke_roundtrip(db_session):
    user = _make_user(db_session, "roundtrip@example.com")

    code = agent_device_service.create_pairing_code(db_session, user)
    device, token = agent_device_service.redeem_pairing_code(db_session, code, name="My Laptop")

    assert device.owner_id == user.id
    assert device.name == "My Laptop"
    assert device.token_hash != token  # only the sha256 hash is ever stored
    assert device.revoked_at is None

    resolved = agent_device_service.authenticate_token(db_session, token)
    assert resolved is not None
    assert resolved.id == device.id

    agent_device_service.revoke(db_session, user, device.id)
    db_session.refresh(device)
    assert device.revoked_at is not None
    # A revoked device's token must no longer authenticate.
    assert agent_device_service.authenticate_token(db_session, token) is None


def test_redeem_pairing_code_defaults_name_when_blank(db_session):
    user = _make_user(db_session, "blank-name@example.com")
    code = agent_device_service.create_pairing_code(db_session, user)

    device, _token = agent_device_service.redeem_pairing_code(db_session, code)

    assert device.name == "Local Agent"


def test_redeem_pairing_code_rejects_garbage_code(db_session):
    with pytest.raises(auth_service.AuthError):
        agent_device_service.redeem_pairing_code(db_session, "not-a-real-jwt")


def test_redeem_pairing_code_rejects_expired_code(db_session, monkeypatch):
    user = _make_user(db_session, "expired@example.com")
    monkeypatch.setattr(agent_device_service, "PAIR_TTL", dt.timedelta(seconds=-1))

    code = agent_device_service.create_pairing_code(db_session, user)
    with pytest.raises(auth_service.AuthError):
        agent_device_service.redeem_pairing_code(db_session, code)


def test_redeem_pairing_code_rejects_wrong_token_type(db_session):
    """A valid access token (typ="access") must not redeem as a pairing code."""
    user = _make_user(db_session, "wrong-type@example.com")
    access_token = auth_service.create_access_token(user, "some-sid")

    with pytest.raises(auth_service.AuthError):
        agent_device_service.redeem_pairing_code(db_session, access_token)


def test_authenticate_token_ignores_blank_or_unknown_token(db_session):
    assert agent_device_service.authenticate_token(db_session, "") is None
    assert agent_device_service.authenticate_token(db_session, "totally-unknown") is None


def test_touch_last_seen_stamps_timestamp(db_session):
    user = _make_user(db_session, "lastseen@example.com")
    code = agent_device_service.create_pairing_code(db_session, user)
    device, _token = agent_device_service.redeem_pairing_code(db_session, code)
    assert device.last_seen_at is None

    agent_device_service.touch_last_seen(db_session, device)
    db_session.refresh(device)
    assert device.last_seen_at is not None


def test_list_devices_excludes_revoked_and_other_users(db_session):
    user_a = _make_user(db_session, "list-a@example.com")
    user_b = _make_user(db_session, "list-b@example.com")

    device_a, _ = agent_device_service.redeem_pairing_code(
        db_session, agent_device_service.create_pairing_code(db_session, user_a)
    )
    device_a2, _ = agent_device_service.redeem_pairing_code(
        db_session, agent_device_service.create_pairing_code(db_session, user_a)
    )
    agent_device_service.redeem_pairing_code(
        db_session, agent_device_service.create_pairing_code(db_session, user_b)
    )
    agent_device_service.revoke(db_session, user_a, device_a2.id)

    devices = agent_device_service.list_devices(db_session, user_a)
    assert [d.id for d in devices] == [device_a.id]


def test_revoke_ignores_device_owned_by_another_user(db_session):
    owner = _make_user(db_session, "owner@example.com")
    other = _make_user(db_session, "other@example.com")
    device, _token = agent_device_service.redeem_pairing_code(
        db_session, agent_device_service.create_pairing_code(db_session, owner)
    )

    assert agent_device_service.revoke(db_session, other, device.id) is None
    db_session.refresh(device)
    assert device.revoked_at is None


def test_revoke_missing_device_returns_none(db_session):
    user = _make_user(db_session, "missing-device@example.com")
    assert agent_device_service.revoke(db_session, user, 999999) is None
