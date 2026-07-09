"""add owner ownership columns

Adds a nullable, indexed ``owner_id`` FK -> ``users.id`` to every per-user-scoped
table (#91 — data is per-user private): ``runs``, ``tickets``, ``projects``,
``project_config``, ``provider_connections``, ``claude_usage``,
``project_knowledge``. Best-effort backfills existing rows to the lowest
``users.id`` (the seeded admin) when any users exist. Nullable for now — a later
cleanup issue (#98) enforces non-null once every write path stamps an owner.

Revision ID: 48496117f693
Revises: 755e3b02b3f9
Create Date: 2026-07-09 11:52:39.528646

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '48496117f693'
down_revision: Union[str, Sequence[str], None] = '755e3b02b3f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tables that gain a per-user owner_id FK.
_OWNED_TABLES = (
    "runs",
    "tickets",
    "projects",
    "project_config",
    "provider_connections",
    "claude_usage",
    "project_knowledge",
)


def upgrade() -> None:
    """Upgrade schema."""
    # Batch mode: SQLite can't ALTER a table to add a constraint in place — it
    # needs the copy-and-move strategy batch_alter_table provides. Also works
    # unchanged on Postgres (a plain ALTER TABLE there).
    for table in _OWNED_TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                op.f(f"fk_{table}_owner_id_users"), "users", ["owner_id"], ["id"]
            )
            batch_op.create_index(op.f(f"ix_{table}_owner_id"), ["owner_id"], unique=False)

    # Best-effort backfill: point every existing row at the lowest user id (the
    # seeded admin) so pre-existing data isn't orphaned once ownership is enforced.
    # A no-op when the users table is empty (fresh/local-first installs).
    bind = op.get_bind()
    admin_id = bind.execute(sa.text("SELECT MIN(id) FROM users")).scalar()
    if admin_id is not None:
        for table in _OWNED_TABLES:
            bind.execute(
                sa.text(f"UPDATE {table} SET owner_id = :admin_id WHERE owner_id IS NULL"),
                {"admin_id": admin_id},
            )


def downgrade() -> None:
    """Downgrade schema."""
    for table in reversed(_OWNED_TABLES):
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_index(op.f(f"ix_{table}_owner_id"))
            batch_op.drop_constraint(op.f(f"fk_{table}_owner_id_users"), type_="foreignkey")
            batch_op.drop_column("owner_id")
