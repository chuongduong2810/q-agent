"""add executions.heal_case_id

Marks a single-case Execution as an agent-executed self-heal (see heal_service
and the /agent/heal/* endpoints). Nullable — normal runs leave it NULL.

Revision ID: c9e2a1f4d7b8
Revises: b5c1f2e70a93
Create Date: 2026-07-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9e2a1f4d7b8"
down_revision = "b5c1f2e70a93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("heal_case_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("executions", "heal_case_id")
