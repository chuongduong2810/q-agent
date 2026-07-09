"""add user last_active and credential metadata columns

Adds ``users.last_active`` (stamped on successful login and token refresh —
see ``routers/auth.py``) and three columns to ``claude_credentials`` parsed
defensively from an uploaded ``.credentials.json``'s ``claudeAiOauth`` object
(falling back to top-level keys): ``expires_at``, ``scopes``,
``subscription_type``. All four columns are nullable with no backfill.

Revision ID: 98ab9f52d3e3
Revises: d048b6376b08
Create Date: 2026-07-09 15:44:00.552533

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db

# revision identifiers, used by Alembic.
revision: str = '98ab9f52d3e3'
down_revision: Union[str, Sequence[str], None] = 'd048b6376b08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("last_active", app.db.UTCDateTime(), nullable=True))

    with op.batch_alter_table("claude_credentials") as batch_op:
        batch_op.add_column(sa.Column("expires_at", app.db.UTCDateTime(), nullable=True))
        batch_op.add_column(sa.Column("scopes", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("subscription_type", sa.String(length=40), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("claude_credentials") as batch_op:
        batch_op.drop_column("subscription_type")
        batch_op.drop_column("scopes")
        batch_op.drop_column("expires_at")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("last_active")
