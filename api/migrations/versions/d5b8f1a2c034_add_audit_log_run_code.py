"""add audit_logs.run_code

Correlates an audit event with the run it belongs to (e.g. "RUN-202"), so the
run workspace can show a per-run activity/log timeline (#394). Nullable — events
not scoped to a run (auth, integration, settings) leave it NULL. Indexed for the
`GET /audit/events?run=` filter.

Revision ID: d5b8f1a2c034
Revises: c9e2a1f4d7b8
Create Date: 2026-07-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d5b8f1a2c034"
down_revision = "c9e2a1f4d7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("run_code", sa.String(length=32), nullable=True))
    op.create_index("ix_audit_logs_run_code", "audit_logs", ["run_code"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_run_code", table_name="audit_logs")
    op.drop_column("audit_logs", "run_code")
