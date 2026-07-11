"""add claude_usage.ticket_external_id

Adds a nullable ``ticket_external_id`` to ``claude_usage`` so per-run AI spend
can be grouped by ticket (the grouped-by-ticket cost card). The analyze+generate
pipeline stamps it from the ambient ticket context; run-level calls stay NULL.
No backfill — historical rows remain ticket-less and fall into the "Run-level"
group.

Revision ID: f2a7c9d41b06
Revises: c1d7e93a5f28
Create Date: 2026-07-12 00:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f2a7c9d41b06'
down_revision: Union[str, Sequence[str], None] = 'c1d7e93a5f28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("claude_usage") as batch_op:
        batch_op.add_column(sa.Column("ticket_external_id", sa.String(length=64), nullable=True))
        batch_op.create_index(
            "ix_claude_usage_ticket_external_id", ["ticket_external_id"], unique=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("claude_usage") as batch_op:
        batch_op.drop_index("ix_claude_usage_ticket_external_id")
        batch_op.drop_column("ticket_external_id")
