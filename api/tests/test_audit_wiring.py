"""Integration tests: real actions write rows into the audit_logs table.

record() commits on its own SessionLocal while the test client reads through the
shared db_session, so assertions query a fresh SessionLocal (matching the pattern
in test_audit.py::test_record_appends_row) to avoid SQLite snapshot flakiness.
"""

from __future__ import annotations


def test_create_run_records_audit_event(client, seed_ticket):
    from app.db import SessionLocal
    from app.models.audit import AuditLog

    resp = client.post("/runs", json={"scope": "selected", "ticketIds": [seed_ticket.external_id]})
    assert resp.status_code == 200
    run_code = resp.json()["code"]

    fresh = SessionLocal()
    try:
        row = (
            fresh.query(AuditLog)
            .filter(AuditLog.action == "Created run", AuditLog.category == "run")
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert row is not None
        assert run_code in row.target
        assert row.actor_type == "user"
    finally:
        fresh.close()


def test_settings_change_records_audit_event(client):
    from app.db import SessionLocal
    from app.models.audit import AuditLog

    resp = client.put("/settings", json={"parallel": 6})
    assert resp.status_code == 200

    fresh = SessionLocal()
    try:
        row = (
            fresh.query(AuditLog)
            .filter(AuditLog.action == "Changed settings", AuditLog.category == "settings")
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert row is not None
        assert row.actor_type == "user"
    finally:
        fresh.close()
