"""Tests for create-and-link test cases + linked-cases listing (adapter mocked)."""

from __future__ import annotations

import time

from app.models.provider_connection import ProviderConnection
from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.services import link_service
from app.services.adapters.base import ProviderAdapter


class _FakeAdapter(ProviderAdapter):
    kind = "ado"
    created: list[str] = []

    def test_connection(self):  # pragma: no cover - unused
        return {"ok": True, "message": "", "detail": {}}

    def list_projects(self):  # pragma: no cover - unused
        return []

    def fetch_tickets(self, **kwargs):  # pragma: no cover - unused
        return []

    def publish_comment(self, *a, **k):  # pragma: no cover - unused
        return "1"

    def create_test_case(self, ticket_external_id, *, title, precondition="", steps=None, priority="Medium", link=True):
        return {"external_id": f"TC-{len(title)}", "url": "http://ado/tc", "status": "Design", "linked": link}


def _seed_run_with_approved_case(db_session, seed_ticket):
    conn = ProviderConnection(kind="ado", name="ADO", connected=True, config={}, secrets={})
    db_session.add(conn)
    db_session.flush()
    seed_ticket.connection_id = conn.id  # stamp the work-item origin
    db_session.add(seed_ticket)
    run = Run(code="RUN-900", name="Linked", scope="selected", scope_label="Selected", status="review")
    db_session.add(run)
    db_session.flush()
    db_session.add(RunTicket(run_id=run.id, ticket_external_id=seed_ticket.external_id, position=0, gen_status="done"))
    db_session.add(
        TestCase(
            run_id=run.id,
            ticket_external_id=seed_ticket.external_id,
            code="TC-01",
            title="Login works",
            precondition="signed in",
            steps=[{"a": "open", "e": "shown"}],
            priority="High",
            approval="approved",
        )
    )
    db_session.commit()
    return run


def test_create_and_link_creates_linked_cases(client, db_session, seed_ticket, monkeypatch):
    run = _seed_run_with_approved_case(db_session, seed_ticket)
    monkeypatch.setattr(link_service, "get_adapter", lambda kind, config, secrets: _FakeAdapter({}, {}))

    resp = client.post(f"/runs/{run.id}/testcases/create-link", json={"link": True})
    assert resp.status_code == 200

    # Background worker completes quickly with the fake adapter.
    for _ in range(50):
        if not link_service.is_running(run.id):
            break
        time.sleep(0.05)

    status = client.get(f"/runs/{run.id}/linked").json()
    assert status["status"] == "done"
    assert status["results"][0]["linked"] is True

    linked = client.get(f"/tickets/{seed_ticket.external_id}/linked-cases").json()
    assert len(linked) == 1
    assert linked[0]["linked"] is True
    assert linked[0]["ticketExternalId"] == seed_ticket.external_id


def test_dry_run_records_locally_without_touching_provider(client, db_session, seed_ticket, monkeypatch):
    run = _seed_run_with_approved_case(db_session, seed_ticket)

    # Any adapter use in dry-run mode is a bug — fail loudly if it's called.
    def _boom(*a, **k):  # pragma: no cover - asserts non-invocation
        raise AssertionError("provider adapter must not be called in dry-run mode")

    monkeypatch.setattr(link_service, "get_adapter", _boom)

    resp = client.post(f"/runs/{run.id}/testcases/create-link", json={"link": True, "dryRun": True})
    assert resp.status_code == 200

    for _ in range(50):
        if not link_service.is_running(run.id):
            break
        time.sleep(0.05)

    status = client.get(f"/runs/{run.id}/linked").json()
    assert status["status"] == "done"
    result = status["results"][0]
    assert result["local"] is True
    assert result["linked"] is False
    assert result["created"] is True

    linked = client.get(f"/tickets/{seed_ticket.external_id}/linked-cases").json()
    assert linked[0]["externalId"].startswith("LOCAL-")


def test_create_and_link_requires_approved(client, db_session, seed_ticket):
    run = Run(code="RUN-901", name="Empty", scope="selected", scope_label="Selected", status="review")
    db_session.add(run)
    db_session.commit()
    resp = client.post(f"/runs/{run.id}/testcases/create-link", json={"link": True})
    assert resp.status_code == 400
