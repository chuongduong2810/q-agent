"""Tests for the per-user ownership foundation (#91).

Covers the ``app.services.ownership`` helpers directly, plus the two create
endpoints (run, connection) that stamp ``owner_id`` when a current user is
resolvable. The suite runs with ``auth_required`` off by default (see
``conftest.workspace_dir``), so most existing tests exercise the ``user=None``
bridge path implicitly; this file also exercises the authed path.
"""

from __future__ import annotations

import pytest

from app.models.run import Run
from app.models.user import User
from app.services import auth_service
from app.services.ownership import get_owned_or_404, owned, stamp_owner


def _make_user(db_session, email="owner@example.com", password="password123", role="member"):
    user = User(
        email=email,
        first_name="Owner",
        last_name="User",
        role=role,
        password_hash=auth_service.hash_password(password),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


# ---------------------------------------------------------------- stamp_owner
def test_stamp_owner_sets_owner_id_when_user_present(db_session):
    user = _make_user(db_session)
    run = Run(code="RUN-900", name="x", scope="selected")
    stamp_owner(run, user)
    assert run.owner_id == user.id


def test_stamp_owner_is_noop_when_user_is_none(db_session):
    run = Run(code="RUN-901", name="x", scope="selected")
    stamp_owner(run, None)
    assert run.owner_id is None


# ---------------------------------------------------------------- owned
def test_owned_filters_by_owner_when_user_present(db_session):
    user_a = _make_user(db_session, email="a@example.com")
    user_b = _make_user(db_session, email="b@example.com")
    db_session.add(Run(code="RUN-910", name="a", scope="selected", owner_id=user_a.id))
    db_session.add(Run(code="RUN-911", name="b", scope="selected", owner_id=user_b.id))
    db_session.commit()

    rows = owned(db_session.query(Run), Run, user_a).all()
    assert [r.code for r in rows] == ["RUN-910"]


def test_owned_is_passthrough_when_user_is_none(db_session):
    db_session.add(Run(code="RUN-920", name="a", scope="selected"))
    db_session.add(Run(code="RUN-921", name="b", scope="selected"))
    db_session.commit()

    rows = owned(db_session.query(Run), Run, None).all()
    codes = {r.code for r in rows}
    assert {"RUN-920", "RUN-921"} <= codes


# ---------------------------------------------------------------- get_owned_or_404
def test_get_owned_or_404_missing_row_raises_404(db_session):
    with pytest.raises(Exception) as exc_info:
        get_owned_or_404(db_session, Run, 999999, None)
    assert getattr(exc_info.value, "status_code", None) == 404


def test_get_owned_or_404_allows_unowned_row_even_with_user(db_session):
    user = _make_user(db_session)
    run = Run(code="RUN-930", name="a", scope="selected")
    db_session.add(run)
    db_session.commit()

    fetched = get_owned_or_404(db_session, Run, run.id, user)
    assert fetched.id == run.id


def test_get_owned_or_404_rejects_other_owner(db_session):
    user_a = _make_user(db_session, email="c@example.com")
    user_b = _make_user(db_session, email="d@example.com")
    run = Run(code="RUN-940", name="a", scope="selected", owner_id=user_a.id)
    db_session.add(run)
    db_session.commit()

    with pytest.raises(Exception) as exc_info:
        get_owned_or_404(db_session, Run, run.id, user_b)
    assert getattr(exc_info.value, "status_code", None) == 404

    # The owner itself can still fetch it.
    assert get_owned_or_404(db_session, Run, run.id, user_a).id == run.id


def test_get_owned_or_404_skips_check_when_user_is_none(db_session):
    user_a = _make_user(db_session, email="e@example.com")
    run = Run(code="RUN-950", name="a", scope="selected", owner_id=user_a.id)
    db_session.add(run)
    db_session.commit()

    assert get_owned_or_404(db_session, Run, run.id, None).id == run.id


# ---------------------------------------------------------------- wiring: create endpoints
def test_create_run_leaves_owner_null_without_auth(client, seed_ticket):
    """Bridge: with auth disabled (the suite default), created runs stay unowned."""
    resp = client.post("/runs", json={"scope": "selected", "ticketIds": [seed_ticket.external_id]})
    assert resp.status_code == 200
    run_id = resp.json()["id"]

    from app.models.run import Run as RunModel

    from app.db import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(RunModel, run_id)
        assert run.owner_id is None
    finally:
        db.close()


def test_create_run_stamps_owner_when_authenticated(client, db_session, seed_ticket, monkeypatch):
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)

    user = _make_user(db_session, email="runowner@example.com")
    token = auth_service.create_access_token(user, sid="test-sid")

    resp = client.post(
        "/runs",
        json={"scope": "selected", "ticketIds": [seed_ticket.external_id]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    run = db_session.get(Run, resp.json()["id"])
    assert run.owner_id == user.id


def test_create_connection_stamps_owner_when_authenticated(client, db_session, monkeypatch):
    import app.config as config_module

    from app.models.provider_connection import ProviderConnection

    monkeypatch.setattr(config_module.settings, "auth_required", True)

    user = _make_user(db_session, email="connowner@example.com")
    token = auth_service.create_access_token(user, sid="test-sid")

    resp = client.post(
        "/providers/ado/connections",
        json={"name": "My ADO"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    conn = db_session.get(ProviderConnection, resp.json()["id"])
    assert conn.owner_id == user.id
