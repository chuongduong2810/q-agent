"""Database engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.config import settings

engine = create_engine(
    settings.resolved_database_url,
    connect_args={"check_same_thread": False},
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


def init_db() -> None:
    """Create all tables (used for local-first bootstrap without Alembic)."""
    # Import models so they register on Base.metadata before create_all.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _sync_columns()
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


def _sync_columns() -> None:
    """Add any model columns missing from existing SQLite tables (light migration).

    Lets the local-first schema evolve (new columns) without dropping the user's
    data — e.g. configured provider credentials. New tables are handled by
    ``create_all``; this only fills in newly-added columns.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'
            default = getattr(col.default, "arg", None) if col.default is not None else None
            if isinstance(default, bool):
                ddl += f" DEFAULT {1 if default else 0}"
            elif isinstance(default, (int, float)):
                ddl += f" DEFAULT {default}"
            elif isinstance(default, str):
                ddl += f" DEFAULT '{default}'"
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
            except Exception:  # noqa: BLE001 - column may already exist / race; ignore
                pass
