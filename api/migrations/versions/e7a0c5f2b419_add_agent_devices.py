"""add agent_devices + execution target/claimed_by_device_id

Adds the Local Agent feature's device-pairing table (``agent_devices`` — mirrors
the ``Session`` model's sha256 token-hash pattern, only the hash of a paired
device's bearer token is ever stored) plus two ``executions`` columns:
``target`` ("server"|"local-agent", default "server") and nullable
``claimed_by_device_id`` FK -> ``agent_devices.id`` (stamped when a paired
device atomically claims a queued local-agent job via ``/agent/jobs/next``).

Revision ID: e7a0c5f2b419
Revises: 24945e8139a8
Create Date: 2026-07-10 00:00:00.000000

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

import app.db

# revision identifiers, used by Alembic.
revision: str = 'e7a0c5f2b419'
down_revision: Union[str, Sequence[str], None] = '24945e8139a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'agent_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', app.db.UTCDateTime(), nullable=False),
        sa.Column('last_seen_at', app.db.UTCDateTime(), nullable=True),
        sa.Column('revoked_at', app.db.UTCDateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_agent_devices_owner_id_users')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_agent_devices_owner_id'), 'agent_devices', ['owner_id'], unique=False)

    with op.batch_alter_table('executions') as batch_op:
        batch_op.add_column(sa.Column('target', sa.String(length=16), nullable=False, server_default='server'))
        batch_op.add_column(sa.Column('claimed_by_device_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            op.f('fk_executions_claimed_by_device_id_agent_devices'),
            'agent_devices',
            ['claimed_by_device_id'],
            ['id'],
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('executions') as batch_op:
        batch_op.drop_constraint(
            op.f('fk_executions_claimed_by_device_id_agent_devices'), type_='foreignkey'
        )
        batch_op.drop_column('claimed_by_device_id')
        batch_op.drop_column('target')

    op.drop_index(op.f('ix_agent_devices_owner_id'), table_name='agent_devices')
    op.drop_table('agent_devices')
