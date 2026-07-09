"""Alembic environment — resolves the DB URL from ``app.config.settings`` and
registers every ORM model on ``app.db.Base`` so autogenerate sees the full schema.
"""

from __future__ import annotations

from sqlalchemy import engine_from_config, pool

from alembic import context

# Import models so they register on Base.metadata before Alembic inspects it.
from app import models  # noqa: F401
from app.config import settings
from app.db import Base

config = context.config

# Deliberately skip `logging.config.fileConfig(...)` here: the app owns its own
# logging setup (`app.logging.setup_logging`, loguru + a stdlib bridge handler
# on the root logger), and `fileConfig` resets/removes root-logger handlers —
# migrations run inside the app's own boot path (`app.db.run_migrations`), so
# applying alembic.ini's `[loggers]` section here would clobber that setup.

target_metadata = Base.metadata


def get_url() -> str:
    """Resolve the database URL from app settings (``QAGENT_DATABASE_URL`` /
    the SQLite default) — the single source of truth, so the ``sqlalchemy.url``
    placeholder in ``alembic.ini`` is never actually used."""
    return settings.resolved_database_url


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (emits SQL only)."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = engine_from_config(
        {"sqlalchemy.url": get_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
