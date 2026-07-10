"""add claude_credentials.prefer_shared

Adds ``claude_credentials.prefer_shared`` — an own-row flag meaning the user has
their own credential on file but prefers the shared account. Lets the AI-stats
popover switch Personal↔Shared without deleting the uploaded token (the
effective-mode precedence in ``app.services.claude_credentials`` honours it).
NOT NULL, server-default false; existing rows backfill to false (own beats
shared, unchanged).

Revision ID: c1d7e93a5f28
Revises: e7a0c5f2b419
Create Date: 2026-07-10 10:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c1d7e93a5f28'
down_revision: Union[str, Sequence[str], None] = 'e7a0c5f2b419'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("claude_credentials") as batch_op:
        batch_op.add_column(
            sa.Column("prefer_shared", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("claude_credentials") as batch_op:
        batch_op.drop_column("prefer_shared")
