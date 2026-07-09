"""Database engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.config import API_DIR, settings


def _connect_args(url: str) -> dict:
    """SQLite needs ``check_same_thread=False`` for our cross-thread session use;
    Postgres (and other drivers) use a normal connection pool with no overrides."""
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(
    settings.resolved_database_url,
    connect_args=_connect_args(settings.resolved_database_url),
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetime stored as naive UTC in SQLite."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):  # noqa: ANN001
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect):  # noqa: ANN001
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def timestamp_column(**kwargs):  # noqa: ANN003, ANN201
    """Helper for created/updated columns with UTC defaults."""
    return mapped_column(UTCDateTime, default=utcnow, **kwargs)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations() -> None:
    """Apply all Alembic migrations up to ``head`` against the current DB.

    Used both at API boot (``main.py`` lifespan, via ``init_db``) and by the test
    fixture that builds each test's isolated temp database — schema creation
    always goes through the same Alembic migration path instead of ad-hoc
    ``create_all``/``ALTER TABLE`` hacks.

    Adopts Alembic on a **pre-Alembic** database: a DB created by the old
    ``create_all`` bootstrap already has the baseline tables but no
    ``alembic_version`` row, so a plain ``upgrade head`` would try to re-create
    those tables and fail ("table already exists"). When we detect that shape we
    first ``stamp`` the baseline revision so ``upgrade`` applies only the delta
    migrations (e.g. owner columns, claude_credentials).
    """
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))

    with engine.connect() as conn:
        inspector = inspect(conn)
        versioned = inspector.has_table("alembic_version")
        # ``audit_logs`` is an original baseline table — its presence without an
        # alembic_version table means the schema predates Alembic adoption.
        legacy_schema = inspector.has_table("audit_logs")
    if not versioned and legacy_schema:
        baseline = ScriptDirectory.from_config(cfg).get_base()
        command.stamp(cfg, baseline)

    command.upgrade(cfg, "head")


def init_db() -> None:
    """Apply migrations and run best-effort data backfills (local-first bootstrap)."""
    run_migrations()
    _backfill_connections()
    _backfill_audit()


def _backfill_connections() -> None:
    """Migrate legacy providers → provider_connections + bindings (best-effort)."""
    try:
        from app.services import connection_service

        db = SessionLocal()
        try:
            connection_service.backfill_from_providers(db)
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - never block startup on the migration
        pass


def _backfill_audit() -> None:
    """Seed the audit_logs table from existing history on first run (best-effort)."""
    try:
        from app.services import audit_service

        db = SessionLocal()
        try:
            audit_service.backfill_from_history(db)
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - never block startup on auditing
        pass
