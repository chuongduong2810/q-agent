"""Tests for the composite-unique ``(key, owner_id)`` constraint (#117, ADR 0009 §3).

``ProjectConfig.key`` and ``ProjectKnowledge.key`` used to be globally unique,
which blocked per-user copies of a same-named project. Both now enforce
uniqueness on the ``(key, owner_id)`` pair instead.
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.knowledge import ProjectKnowledge
from app.models.project_config import ProjectConfig
from app.models.user import User
from app.services import auth_service


def _make_user(db_session, email, password="password123", role="member"):
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


# ---------------------------------------------------------------- ProjectConfig
def test_project_config_same_key_different_owners_both_persist(db_session):
    user_a = _make_user(db_session, "pc-a@example.com")
    user_b = _make_user(db_session, "pc-b@example.com")

    db_session.add(ProjectConfig(key="Surency", name="Surency", owner_id=user_a.id))
    db_session.add(ProjectConfig(key="Surency", name="Surency", owner_id=user_b.id))
    db_session.commit()

    rows = db_session.query(ProjectConfig).filter_by(key="Surency").all()
    assert {r.owner_id for r in rows} == {user_a.id, user_b.id}


def test_project_config_same_key_same_owner_twice_raises_integrity_error(db_session):
    user = _make_user(db_session, "pc-c@example.com")

    db_session.add(ProjectConfig(key="Surency", name="Surency", owner_id=user.id))
    db_session.commit()

    db_session.add(ProjectConfig(key="Surency", name="Surency", owner_id=user.id))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ------------------------------------------------------------- ProjectKnowledge
def test_project_knowledge_same_key_different_owners_both_persist(db_session):
    user_a = _make_user(db_session, "pk-a@example.com")
    user_b = _make_user(db_session, "pk-b@example.com")

    db_session.add(ProjectKnowledge(key="Surency", name="Surency", owner_id=user_a.id))
    db_session.add(ProjectKnowledge(key="Surency", name="Surency", owner_id=user_b.id))
    db_session.commit()

    rows = db_session.query(ProjectKnowledge).filter_by(key="Surency").all()
    assert {r.owner_id for r in rows} == {user_a.id, user_b.id}


def test_project_knowledge_same_key_same_owner_twice_raises_integrity_error(db_session):
    user = _make_user(db_session, "pk-c@example.com")

    db_session.add(ProjectKnowledge(key="Surency", name="Surency", owner_id=user.id))
    db_session.commit()

    db_session.add(ProjectKnowledge(key="Surency", name="Surency", owner_id=user.id))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
