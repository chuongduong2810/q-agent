"""add claude_credentials

Adds the ``claude_credentials`` table (#95): one row per user's own Claude CLI
``.credentials.json`` (Fernet-encrypted), plus at most one shared/admin row
(``owner_id`` NULL) used as the fallback when a user has no credential of their
own.

Revision ID: d048b6376b08
Revises: 48496117f693
Create Date: 2026-07-09 12:30:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db

# revision identifiers, used by Alembic.
revision: str = 'd048b6376b08'
down_revision: Union[str, Sequence[str], None] = '48496117f693'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'claude_credentials',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('credentials', sa.Text(), nullable=False),
        sa.Column('label', sa.String(length=120), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', app.db.UTCDateTime(), nullable=False),
        sa.Column('updated_at', app.db.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_claude_credentials_owner_id_users')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_claude_credentials_owner_id'), 'claude_credentials', ['owner_id'], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_claude_credentials_owner_id'), table_name='claude_credentials')
    op.drop_table('claude_credentials')
