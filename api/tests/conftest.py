"""Unified pytest fixtures for the whole backend test suite.

Every test runs against its own on-disk temp SQLite database. We rebind the
global ``app.db.engine`` / ``SessionLocal`` (and ``app.config.settings``) to the
temp DB/workspace *before* the app is built, so that both request-handling
sessions (``get_db``) and background-thread sessions (``SessionLocal()`` opened by
the AI / automation / execution pipelines) hit the same isolated database.

This conftest merges the fixture surfaces authored by the four backend feature
workstreams: ``client``, ``db_session``, ``seed_ticket``, ``app``, ``app_env``,
``workspace_dir``.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture
def workspace_dir(tmp_path, monkeypatch) -> Iterator:
    """Point the app's workspace (DB + specs + evidence) at a temp directory and
    rebind the engine/session/settings singletons accordingly."""
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("QAGENT_WORKSPACE_DIR", str(ws))
    monkeypatch.setenv("QAGENT_DATABASE_URL", f"sqlite:///{(ws / 'test.db').as_posix()}")

    import app.config as config_module

    config_module.get_settings.cache_clear()
    fresh = config_module.get_settings()
    # Mutate the singleton in place so modules that did `from app.config import
    # settings` at import time see the temp workspace too.
    config_module.settings.__dict__.update(fresh.__dict__)
    # The app enforces auth by default (#79); the suite exercises handlers
    # without auth plumbing, so disable enforcement here. test_auth opts back in
    # per-test via its own `auth_on` fixture.
    config_module.settings.auth_required = False
    config_module.settings.ensure_dirs()
    settings = config_module.settings

    import app.db as db_module

    monkeypatch.setattr(db_module, "settings", settings)
    new_engine = db_module.create_engine(
        settings.resolved_database_url, connect_args={"check_same_thread": False}, echo=False
    )
    monkeypatch.setattr(db_module, "engine", new_engine)
    new_session_local = db_module.sessionmaker(
        bind=new_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    monkeypatch.setattr(db_module, "SessionLocal", new_session_local)

    db_module.init_db()
    yield ws


# Alias kept for the workstream that named the base fixture `app_env`.
@pytest.fixture
def app_env(workspace_dir) -> Iterator[dict]:
    import app.config as config_module

    yield {"settings": config_module.settings, "workspace": workspace_dir}


@pytest.fixture
def db_session(workspace_dir):
    """A session bound to the isolated temp DB."""
    import app.db as db_module

    session = db_module.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def app(workspace_dir):
    """A fresh FastAPI app wired to the isolated temp DB."""
    from app.main import create_app

    return create_app()


@pytest.fixture
def client(app, db_session):
    """TestClient wired to the isolated DB. `get_db` is overridden to the shared
    session so request writes and test assertions see one consistent DB."""
    from app.db import get_db
    from fastapi.testclient import TestClient

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def seed_ticket(db_session):
    """Seed one Ticket row directly in the temp DB (used by AI/review tests)."""
    from app.models.ticket import Ticket

    ticket = Ticket(
        external_id="SUR-1428",
        provider_kind="ado",
        title="Add password reset flow",
        work_item_type="User Story",
        status="Ready for QA",
        priority="High",
        assignee="Maya Kaur",
        sprint="Sprint 12",
        description="As a user I want to reset my password via email link.",
        acceptance_criteria=[
            "Given a valid email, a reset link is sent",
            "Reset link expires after 30 minutes",
        ],
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)
    return ticket
