"""Tests for #92 — scoping the run domain to its owner.

With ``auth_required=True`` two users each get a bearer token; user A's run is
invisible to user B across reads/mutations, the run's ``/artifacts`` files, and
its WS channel. The rest of the suite runs with auth disabled (the
``owned``/``get_owned_or_404`` bridge from #91 is then a no-op), so this file
is the only place these owner checks are exercised end-to-end.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.models.run import Run, RunTicket
from app.models.user import User
from app.services import auth_service


@pytest.fixture
def auth_on(monkeypatch):
    """Turn the global auth guard on for the duration of a test."""
    import app.config as config_module

    monkeypatch.setattr(config_module.settings, "auth_required", True)
    yield


def _make_user(db_session, email: str) -> User:
    user = User(
        email=email,
        first_name="Test",
        last_name="User",
        role="member",
        password_hash=auth_service.hash_password("password123"),
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _token(user: User) -> str:
    return auth_service.create_access_token(user, sid=f"sid-{user.id}")


def _make_owned_run(db_session, owner: User, code: str = "RUN-800") -> Run:
    run = Run(code=code, name="Owned run", scope="selected", status="done", owner_id=owner.id)
    db_session.add(run)
    db_session.flush()
    db_session.add(RunTicket(run_id=run.id, ticket_external_id="SUR-1", position=0))
    db_session.commit()
    db_session.refresh(run)
    return run


@pytest.fixture
def two_users(db_session):
    user_a = _make_user(db_session, "owner-a@example.com")
    user_b = _make_user(db_session, "other-b@example.com")
    return user_a, user_b


def test_owner_can_read_their_own_run(client, db_session, auth_on, two_users):
    user_a, _ = two_users
    run = _make_owned_run(db_session, user_a)
    headers = {"Authorization": f"Bearer {_token(user_a)}"}

    assert client.get(f"/runs/{run.id}", headers=headers).status_code == 200
    listed = client.get("/runs", headers=headers).json()
    assert [r["id"] for r in listed] == [run.id]
    assert client.get(f"/runs/{run.id}/tickets", headers=headers).status_code == 200


def test_other_user_gets_404_on_run_reads(client, db_session, auth_on, two_users):
    user_a, user_b = two_users
    run = _make_owned_run(db_session, user_a)
    headers_b = {"Authorization": f"Bearer {_token(user_b)}"}

    assert client.get(f"/runs/{run.id}", headers=headers_b).status_code == 404
    assert client.get(f"/runs/{run.id}/tickets", headers=headers_b).status_code == 404
    # The owner's run is excluded from user B's list entirely, not just 404'd.
    assert client.get("/runs", headers=headers_b).json() == []


def test_other_user_gets_404_on_run_mutations(client, db_session, auth_on, two_users):
    user_a, user_b = two_users
    run = _make_owned_run(db_session, user_a)
    headers_b = {"Authorization": f"Bearer {_token(user_b)}"}

    assert client.post(f"/runs/{run.id}/cancel", headers=headers_b).status_code == 404
    assert client.delete(f"/runs/{run.id}", headers=headers_b).status_code == 404


def test_other_user_gets_404_on_artifacts(client, db_session, auth_on, two_users):
    """The run's evidence files aren't reachable by anyone but its owner."""
    user_a, user_b = two_users
    run = _make_owned_run(db_session, user_a)

    evidence_dir = settings.evidence_dir / run.code
    evidence_dir.mkdir(parents=True, exist_ok=True)
    (evidence_dir / "shot.png").write_bytes(b"fake-png")

    url = f"/artifacts/{run.code}/shot.png"
    assert client.get(url, params={"token": _token(user_a)}).status_code == 200
    assert client.get(url, params={"token": _token(user_b)}).status_code == 404


def test_other_user_rejected_on_run_ws(client, db_session, auth_on, two_users):
    from starlette.websockets import WebSocketDisconnect

    user_a, user_b = two_users
    run = _make_owned_run(db_session, user_a)

    with client.websocket_connect(f"/ws/runs/{run.id}?token={_token(user_a)}"):
        pass  # the owner connects fine

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/runs/{run.id}?token={_token(user_b)}"):
            pass
