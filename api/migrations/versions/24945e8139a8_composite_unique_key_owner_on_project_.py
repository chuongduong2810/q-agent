"""composite unique key owner on project_config and project_knowledge

ADR 0009 §3 — ``ProjectConfig.key`` and ``ProjectKnowledge.key`` drop their
global unique index in favor of a composite ``UNIQUE (key, owner_id)``
constraint, so the same project ``key`` can exist once per owner and once in
the shared namespace (``owner_id IS NULL``). The original unique index on
each table's ``key`` column was created in the baseline migration
(``755e3b02b3f9``) as ``ix_project_config_key`` / ``ix_project_knowledge_key``
(a unique *index*, not a named constraint — SQLAlchemy's
``unique=True, index=True`` collapses to one unique index). ``owner_id`` was
added later by ``48496117f693``. Uses ``batch_alter_table`` throughout since
SQLite cannot add a table constraint in place.

Revision ID: 24945e8139a8
Revises: 98ab9f52d3e3
Create Date: 2026-07-09 17:42:53.099357

"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '24945e8139a8'
down_revision: Union[str, Sequence[str], None] = '98ab9f52d3e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("project_config") as batch_op:
        batch_op.drop_index(op.f("ix_project_config_key"))
        batch_op.create_index(op.f("ix_project_config_key"), ["key"], unique=False)
        batch_op.create_unique_constraint(
            op.f("uq_project_config_key_owner"), ["key", "owner_id"]
        )

    with op.batch_alter_table("project_knowledge") as batch_op:
        batch_op.drop_index(op.f("ix_project_knowledge_key"))
        batch_op.create_index(op.f("ix_project_knowledge_key"), ["key"], unique=False)
        batch_op.create_unique_constraint(
            op.f("uq_project_knowledge_key_owner"), ["key", "owner_id"]
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("project_knowledge") as batch_op:
        batch_op.drop_constraint(op.f("uq_project_knowledge_key_owner"), type_="unique")
        batch_op.drop_index(op.f("ix_project_knowledge_key"))
        batch_op.create_index(op.f("ix_project_knowledge_key"), ["key"], unique=True)

    with op.batch_alter_table("project_config") as batch_op:
        batch_op.drop_constraint(op.f("uq_project_config_key_owner"), type_="unique")
        batch_op.drop_index(op.f("ix_project_config_key"))
        batch_op.create_index(op.f("ix_project_config_key"), ["key"], unique=True)
