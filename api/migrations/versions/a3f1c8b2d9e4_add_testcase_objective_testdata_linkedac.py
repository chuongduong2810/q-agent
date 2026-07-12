"""add test_cases.objective / test_data / linked_ac

Adds the fields the test-case-generator skill mandates but the JSON contract
dropped (#177): a one-line ``objective``, structured ``test_data`` ([{field,
value}]), and ``linked_ac`` (the acceptance criteria a case covers — the atomic
traceability link the run's AC→cases coverage matrix is derived from). Existing
rows get non-null defaults (empty string / empty array) so no backfill is needed
and the NOT NULL model contract holds.

Revision ID: a3f1c8b2d9e4
Revises: f2a7c9d41b06
Create Date: 2026-07-12 00:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3f1c8b2d9e4'
down_revision: Union[str, Sequence[str], None] = 'f2a7c9d41b06'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("test_cases") as batch_op:
        batch_op.add_column(
            sa.Column("objective", sa.Text(), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("test_data", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )
        batch_op.add_column(
            sa.Column("linked_ac", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("test_cases") as batch_op:
        batch_op.drop_column("linked_ac")
        batch_op.drop_column("test_data")
        batch_op.drop_column("objective")
