"""One-time data import: copy an existing local SQLite ``q-agent.db`` into a
PostgreSQL database, table by table, via SQLAlchemy reflection.

Usage (run from ``api/``, with the target Postgres schema already migrated —
``uv run alembic upgrade head`` against ``--to``):

    uv run python scripts/import_sqlite_to_postgres.py \\
        --from sqlite:///workspace/q-agent.db \\
        --to postgresql+psycopg://user:password@localhost:5432/qagent

This is a best-effort bulk copy for anyone with local SQLite data worth
keeping when moving to a shared Postgres deployment (Phase 1 of
``docs/MULTI-USER-MIGRATION-PLAN.md``). It copies rows in dependency order
(so foreign keys resolve) and skips a table if it's already non-empty on the
target (idempotent re-runs after a partial failure). It does NOT create the
schema — run Alembic migrations against the target first.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import MetaData, create_engine, insert, select
from sqlalchemy.engine import Engine


def _connect_args(url: str) -> dict:
    """Match ``app.db``'s SQLite-only ``check_same_thread`` override."""
    return {"check_same_thread": False} if url.startswith("sqlite") else {}


def copy_table(source: Engine, target: Engine, metadata: MetaData, table_name: str) -> int:
    """Copy every row of ``table_name`` from ``source`` to ``target``.

    Returns the number of rows copied. Skips (returns 0) if the target table
    already has rows, so a re-run after a partial failure doesn't duplicate data.
    """
    table = metadata.tables[table_name]
    with target.connect() as tgt_conn:
        existing = tgt_conn.execute(select(table.c[list(table.columns.keys())[0]]).limit(1)).first()
        if existing is not None:
            print(f"  skip {table_name}: target already has rows")
            return 0

    with source.connect() as src_conn:
        rows = [dict(row._mapping) for row in src_conn.execute(select(table))]
    if not rows:
        print(f"  skip {table_name}: source is empty")
        return 0

    with target.begin() as tgt_conn:
        tgt_conn.execute(insert(table), rows)
    print(f"  copied {table_name}: {len(rows)} rows")
    return len(rows)


def main() -> None:
    """Parse CLI args and copy every table from the source SQLite DB to Postgres."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="source_url", required=True, help="Source SQLite URL")
    parser.add_argument("--to", dest="target_url", required=True, help="Target PostgreSQL URL")
    args = parser.parse_args()

    source = create_engine(args.source_url, connect_args=_connect_args(args.source_url))
    target = create_engine(args.target_url, connect_args=_connect_args(args.target_url))

    # Reflect the target's schema (already migrated via `alembic upgrade head`)
    # and use its dependency-sorted table order so foreign keys resolve.
    metadata = MetaData()
    metadata.reflect(bind=target)
    if not metadata.sorted_tables:
        print("Target has no tables — run `alembic upgrade head` against --to first.", file=sys.stderr)
        raise SystemExit(1)

    total = 0
    for table in metadata.sorted_tables:
        if table.name == "alembic_version":
            continue
        total += copy_table(source, target, metadata, table.name)
    print(f"Done. Copied {total} rows total.")


if __name__ == "__main__":
    main()
