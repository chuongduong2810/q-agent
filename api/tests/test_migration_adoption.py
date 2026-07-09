"""Regression test: adopting Alembic on a pre-Alembic database.

A database created by the old ``create_all`` bootstrap has the baseline tables but
no ``alembic_version`` row. A plain ``upgrade head`` would then try to re-create
those tables and fail ("table audit_logs already exists"). ``run_migrations`` must
detect that shape, stamp the baseline, and apply only the delta migrations.
"""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import API_DIR

BASELINE = "755e3b02b3f9"


def _alembic_cfg() -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    return cfg


def _has_owner_id(engine, table: str) -> bool:
    return any(col["name"] == "owner_id" for col in inspect(engine).get_columns(table))


def test_run_migrations_adopts_pre_alembic_db(tmp_path, monkeypatch):
    """A baseline-only DB with no alembic_version is migrated to head cleanly."""
    import app.config as config_module
    import app.db as db_module

    url = f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}"
    monkeypatch.setenv("QAGENT_DATABASE_URL", url)
    # Point both the ORM engine (used for the pre-Alembic detection) and the
    # settings singleton (read by migrations/env.py) at the temp DB.
    monkeypatch.setattr(config_module.settings, "database_url", url)
    engine = create_engine(url, connect_args={"check_same_thread": False})
    monkeypatch.setattr(db_module, "engine", engine)

    # Build an ORIGINAL-only schema, then strip the version table so the DB looks
    # exactly like one created by the pre-Alembic create_all bootstrap.
    command.upgrade(_alembic_cfg(), BASELINE)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))

    insp = inspect(engine)
    assert insp.has_table("audit_logs")
    assert not insp.has_table("alembic_version")
    assert not _has_owner_id(engine, "runs")
    assert not insp.has_table("claude_credentials")

    # Adopt: must not raise, and must apply the delta migrations.
    db_module.run_migrations()

    insp = inspect(engine)
    assert insp.has_table("alembic_version")
    assert _has_owner_id(engine, "runs")
    assert insp.has_table("claude_credentials")


def test_run_migrations_fresh_db_from_empty(tmp_path, monkeypatch):
    """A truly empty DB migrates straight to head (no false-positive stamp)."""
    import app.config as config_module
    import app.db as db_module

    url = f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    monkeypatch.setenv("QAGENT_DATABASE_URL", url)
    monkeypatch.setattr(config_module.settings, "database_url", url)
    engine = create_engine(url, connect_args={"check_same_thread": False})
    monkeypatch.setattr(db_module, "engine", engine)

    db_module.run_migrations()

    insp = inspect(engine)
    assert insp.has_table("alembic_version")
    assert insp.has_table("audit_logs")
    assert _has_owner_id(engine, "runs")
    assert insp.has_table("claude_credentials")
