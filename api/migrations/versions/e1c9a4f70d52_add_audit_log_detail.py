"""add audit_logs.detail

A nullable JSON blob of structured extra detail for an audit event (#396). Used
by exploration events to carry the observe→decide→act step trail and the
concrete discovered routes/selectors, so the run Activity view can show what an
Explore actually did and wrote to the KB — not just summary counts.

Revision ID: e1c9a4f70d52
Revises: d5b8f1a2c034
Create Date: 2026-07-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e1c9a4f70d52"
down_revision = "d5b8f1a2c034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("detail", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "detail")
