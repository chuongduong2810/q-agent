"""Tests for the split connection model (ADR 0006).

Covers: work-item route-by-origin (two ADO connections → the right one is used by
link + publish), repository resolution via the project's bound repository
connection, project-config saving both bindings, and the legacy-Provider backfill.
"""

from __future__ import annotations

import time

from app.models.project_config import ProjectConfig
from app.models.provider import Provider
from app.models.provider_connection import ProviderConnection
from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.services import connection_service, link_service, publish_service
from app.services.adapters.base import ProviderAdapter


# ----------------------------------------------------- resolution unit tests
def test_resolve_work_item_prefers_stamped_connection(db_session):
    a = ProviderConnection(kind="ado", name="ADO A", config={"project": "A"})
    b = ProviderConnection(kind="ado", name="ADO B", config={"project": "B"})
    db_session.add_all([a, b])
    db_session.flush()
    ticket = Ticket(external_id="T-1", provider_kind="ado", title="t", connection_id=b.id)
    db_session.add(ticket)
    db_session.commit()

    resolved = connection_service.resolve_work_item_for_ticket(db_session, ticket)
    assert resolved.id == b.id  # the ticket's stamped origin, not the first of the kind


def test_resolve_work_item_falls_back_to_first_of_kind(db_session):
    a = ProviderConnection(kind="ado", name="ADO A")
    db_session.add(a)
    db_session.flush()
    ticket = Ticket(external_id="T-1", provider_kind="ado", title="t")  # unstamped
    db_session.add(ticket)
    db_session.commit()

    assert connection_service.resolve_work_item_for_ticket(db_session, ticket).id == a.id


def test_resolve_repository_prefers_project_binding(db_session):
    gh1 = ProviderConnection(kind="github", name="GH One")
    gh2 = ProviderConnection(kind="github", name="GH Two")
    db_session.add_all([gh1, gh2])
    db_session.flush()
    db_session.add(ProjectConfig(key="P", name="P", repository_connection_id=gh2.id))
    db_session.commit()

    assert connection_service.resolve_repository_for_project(db_session, "P").id == gh2.id


def test_connections_with_capability(db_session):
    db_session.add_all([
        ProviderConnection(kind="ado", name="a"),
        ProviderConnection(kind="jira", name="j"),
        ProviderConnection(kind="github", name="g"),
    ])
    db_session.commit()
    wi = {c.kind for c in connection_service.connections_with_capability(db_session, "work_item")}
    repo = {c.kind for c in connection_service.connections_with_capability(db_session, "repository")}
    assert wi == {"ado", "jira"}
    assert repo == {"ado", "github"}


def test_ado_connection_is_dual_capability(db_session):
    """Azure DevOps carries both work_item and repository capabilities (ADR 0006 rev 2)."""
    ado = ProviderConnection(kind="ado", name="ADO")
    db_session.add(ado)
    db_session.commit()

    wi_ids = {c.id for c in connection_service.connections_with_capability(db_session, "work_item")}
    repo_ids = {c.id for c in connection_service.connections_with_capability(db_session, "repository")}
    assert ado.id in wi_ids
    assert ado.id in repo_ids


def test_repository_resolution_accepts_ado_connection(client, db_session):
    """A project's repository_connection_id may point at an ADO connection."""
    ado = ProviderConnection(kind="ado", name="ADO")
    db_session.add(ado)
    db_session.commit()

    resp = client.put(
        "/projects/Surency Platform/config",
        json={"repositoryConnectionId": ado.id},
    )
    assert resp.status_code == 200
    assert resp.json()["repositoryConnectionId"] == ado.id

    resolved = connection_service.resolve_repository_for_project(db_session, "Surency Platform")
    assert resolved.id == ado.id


# ------------------------------------------------------- project-config bindings
def test_project_config_saves_both_bindings(client, db_session):
    wi = ProviderConnection(kind="ado", name="ADO")
    repo = ProviderConnection(kind="github", name="GitHub")
    db_session.add_all([wi, repo])
    db_session.commit()

    resp = client.put(
        "/projects/Surency Platform/config",
        json={"workItemConnectionId": wi.id, "repositoryConnectionId": repo.id},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["workItemConnectionId"] == wi.id
    assert body["repositoryConnectionId"] == repo.id

    row = db_session.query(ProjectConfig).filter(ProjectConfig.key == "Surency Platform").first()
    assert row.work_item_connection_id == wi.id
    assert row.repository_connection_id == repo.id


# ------------------------------------------------------------------ backfill
def test_backfill_from_legacy_provider_rows(db_session):
    # A legacy Provider + a ProjectConfig with null bindings + an unstamped ticket.
    db_session.add(Provider(kind="ado", name="Legacy ADO", connected=True,
                            config={"project": "Surency Platform"}, secrets={"pat": "x"}))
    db_session.add(Provider(kind="github", name="Legacy GH", connected=True,
                            config={"org": "surency"}, secrets={}))
    db_session.add(ProjectConfig(key="Surency Platform", name="Surency Platform"))
    db_session.add(Ticket(external_id="SUR-1", provider_kind="ado", title="t"))
    db_session.commit()

    connection_service.backfill_from_providers(db_session)
    db_session.expire_all()

    conns = db_session.query(ProviderConnection).all()
    assert {c.kind for c in conns} == {"ado", "github"}
    ado = next(c for c in conns if c.kind == "ado")
    github = next(c for c in conns if c.kind == "github")

    cfg = db_session.query(ProjectConfig).filter(ProjectConfig.key == "Surency Platform").first()
    assert cfg.work_item_connection_id == ado.id
    # ADO is repository-capable too (revision 2) and comes first by id, so the
    # first-of-capability fallback binds repository to it, not the (unused) GitHub row.
    assert cfg.repository_connection_id == ado.id
    assert cfg.repository_connection_id != github.id

    ticket = db_session.query(Ticket).filter(Ticket.external_id == "SUR-1").first()
    assert ticket.connection_id == ado.id


def test_backfill_is_idempotent(db_session):
    db_session.add(Provider(kind="ado", name="Legacy ADO", config={}, secrets={}))
    db_session.commit()
    connection_service.backfill_from_providers(db_session)
    connection_service.backfill_from_providers(db_session)
    assert db_session.query(ProviderConnection).count() == 1


# ------------------------------------------------- work-item route-by-origin
class _RecordingAdapter(ProviderAdapter):
    """Records which connection (by config marker) each publish/create came from."""

    kind = "ado"
    seen: list[str] = []

    def test_connection(self):  # pragma: no cover
        return {"ok": True, "message": "", "detail": {}}

    def list_projects(self):  # pragma: no cover
        return []

    def fetch_tickets(self, **kwargs):  # pragma: no cover
        return []

    def publish_comment(self, ticket_external_id, body, *, attachments=None):
        _RecordingAdapter.seen.append(self.config.get("marker", ""))
        return f"ext-{ticket_external_id}"

    def create_test_case(self, ticket_external_id, *, title, precondition="", steps=None,
                         priority="Medium", link=True):
        _RecordingAdapter.seen.append(self.config.get("marker", ""))
        return {"external_id": "TC-1", "url": "", "status": "Design", "linked": link}


def _fake_get_adapter(kind, config, secrets):
    return _RecordingAdapter(config, secrets)


def test_publish_routes_by_ticket_origin(client, db_session, monkeypatch):
    """With two ADO connections, publish uses the ticket's stamped connection."""
    from app.models.comment import TicketComment

    a = ProviderConnection(kind="ado", name="ADO A", config={"marker": "A"})
    b = ProviderConnection(kind="ado", name="ADO B", config={"marker": "B"})
    db_session.add_all([a, b])
    db_session.flush()
    # Ticket originates from connection B (not the first-of-kind, A).
    db_session.add(Ticket(external_id="SUR-1", provider_kind="ado", title="t", connection_id=b.id))
    db_session.add(Run(id=1, code="RUN-1", name="R", status="comment"))
    db_session.add(TicketComment(run_id=1, ticket_external_id="SUR-1", provider_kind="ado",
                                 body="hi", status="draft"))
    db_session.commit()

    _RecordingAdapter.seen = []
    monkeypatch.setattr(publish_service, "get_adapter", _fake_get_adapter)

    comment = db_session.query(TicketComment).first()
    publish_service.publish_one(db_session, comment)
    assert _RecordingAdapter.seen == ["B"]  # routed to the ticket's origin, not A


def test_link_routes_by_ticket_origin(client, db_session, monkeypatch):
    """With two ADO connections, create+link uses the ticket's stamped connection."""
    a = ProviderConnection(kind="ado", name="ADO A", config={"marker": "A"})
    b = ProviderConnection(kind="ado", name="ADO B", config={"marker": "B"})
    db_session.add_all([a, b])
    db_session.flush()
    db_session.add(Ticket(external_id="SUR-1", provider_kind="ado", title="t", connection_id=b.id))
    run = Run(code="RUN-2", name="R", scope="selected", scope_label="Selected", status="review")
    db_session.add(run)
    db_session.flush()
    db_session.add(RunTicket(run_id=run.id, ticket_external_id="SUR-1", position=0, gen_status="done"))
    db_session.add(TestCase(run_id=run.id, ticket_external_id="SUR-1", code="TC-01",
                            title="works", approval="approved"))
    db_session.commit()

    _RecordingAdapter.seen = []
    monkeypatch.setattr(link_service, "get_adapter", _fake_get_adapter)

    resp = client.post(f"/runs/{run.id}/testcases/create-link", json={"link": True})
    assert resp.status_code == 200
    for _ in range(50):
        if not link_service.is_running(run.id):
            break
        time.sleep(0.05)

    assert _RecordingAdapter.seen == ["B"]  # routed to the ticket's origin, not A
