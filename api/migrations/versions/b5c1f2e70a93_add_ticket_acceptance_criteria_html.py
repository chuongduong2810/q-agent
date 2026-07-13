"""add tickets.acceptance_criteria_html

Adds a nullable ``acceptance_criteria_html`` TEXT column to ``tickets`` so the
ticket-detail view can fall back to the ORIGINAL provider AC formatting (rich
HTML) when the criteria don't split cleanly into a numbered list (#225). The
existing ``acceptance_criteria`` list column is kept. Existing rows default to
an empty string via ``server_default`` — no backfill needed, and the ADD COLUMN
form works on both SQLite (tests) and Postgres (prod).

Revision ID: b5c1f2e70a93
Revises: a3f1c8b2d9e4
Create Date: 2026-07-13 00:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b5c1f2e70a93'
down_revision: Union[str, Sequence[str], None] = 'a3f1c8b2d9e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("tickets") as batch_op:
        batch_op.add_column(
            sa.Column("acceptance_criteria_html", sa.Text(), nullable=True, server_default="")
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("tickets") as batch_op:
        batch_op.drop_column("acceptance_criteria_html")
