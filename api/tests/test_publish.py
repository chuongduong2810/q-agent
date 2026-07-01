"""Tests for comment preparation, editing, and publish/retry orchestration."""

from __future__ import annotations

import pytest


class FakeAdapter:
    """Records publish_comment/update_status calls instead of hitting a real API."""

    calls: list[dict] = []
    fail_tickets: set[str] = set()

    def __init__(self, config, secrets):  # noqa: ANN001
        self.config = config
        self.secrets = secrets

    def publish_comment(self, ticket_external_id, body, *, attachments=None):  # noqa: ANN001
        if ticket_external_id in FakeAdapter.fail_tickets:
            raise RuntimeError(f"upstream rejected comment for {ticket_external_id}")
        FakeAdapter.calls.append(
            {"ticket": ticket_external_id, "body": body, "attachments": attachments}
        )
        return f"ext-comment-{ticket_external_id}"

    def update_status(self, ticket_external_id, target_status):  # noqa: ANN001
        FakeAdapter.calls.append({"ticket": ticket_external_id, "status": target_status})


@pytest.fixture(autouse=True)
def _reset_fake_adapter():
    FakeAdapter.calls = []
    FakeAdapter.fail_tickets = set()
    yield


def _seed_report(db_session, run_id: int = 1, second_ticket_fails: bool = False):
    from app.models.provider import Provider
    from app.models.report import Report
    from app.models.run import Run
    from app.models.ticket import Ticket
    from app import crypto

    db_session.add(Run(id=run_id, code="RUN-1", name="Run 1", status="comment"))
    db_session.add(Ticket(external_id="SUR-1", provider_kind="ado", title="Login works"))
    db_session.add(Ticket(external_id="SUR-2", provider_kind="ado", title="Logout works"))
    db_session.add(
        Provider(
            kind="ado",
            name="Azure DevOps",
            connected=True,
            config={"org_url": "https://dev.azure.com/acme"},
            secrets={"pat": crypto.encrypt("super-secret-pat")},
        )
    )

    ticket_summary = [
        {"ticketExternalId": "SUR-1", "passed": 2, "failed": 0, "total": 2},
        {
            "ticketExternalId": "SUR-2",
            "passed": 1,
            "failed": 1 if second_ticket_fails else 0,
            "total": 2,
        },
    ]
    db_session.add(
        Report(
            run_id=run_id,
            execution_id=1,
            overall_result="failed" if second_ticket_fails else "passed",
            pass_rate=75.0 if second_ticket_fails else 100.0,
            passed=3,
            failed=1 if second_ticket_fails else 0,
            duration_s=10,
            env="Staging",
            data={"ticketSummary": ticket_summary, "aiFailureAnalysis": "flaky click handler"},
        )
    )
    db_session.commit()


def _patch_adapter_and_claude(monkeypatch):
    from app.services import publish_service
    from app.routers import comments as comments_router

    monkeypatch.setattr(publish_service, "get_adapter", lambda kind, config, secrets: FakeAdapter(config, secrets))
    monkeypatch.setattr(
        comments_router.claude_cli, "run_prompt", lambda prompt, **k: f"QA summary: {prompt[:20]}..."
    )


def test_prepare_comments_creates_drafts_with_status_mapping(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session, second_ticket_fails=True)

    resp = client.post("/runs/1/comments/prepare")
    assert resp.status_code == 200
    comments = resp.json()
    assert len(comments) == 2

    by_ticket = {c["ticketExternalId"]: c for c in comments}
    assert by_ticket["SUR-1"]["targetStatus"] == "Passed"
    assert by_ticket["SUR-1"]["status"] == "draft"
    assert by_ticket["SUR-2"]["targetStatus"] == "QA Failed"
    assert all(c["body"] for c in comments)


def test_list_comments(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session)
    client.post("/runs/1/comments/prepare")

    resp = client.get("/runs/1/comments")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_patch_comment_edits_body_and_target_status(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session)
    prepared = client.post("/runs/1/comments/prepare").json()
    comment_id = prepared[0]["id"]

    resp = client.patch(f"/comments/{comment_id}", json={"body": "Edited body", "targetStatus": "Testing"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["body"] == "Edited body"
    assert body["targetStatus"] == "Testing"


def test_publish_single_comment_success(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session)
    prepared = client.post("/runs/1/comments/prepare").json()
    comment_id = prepared[0]["id"]

    resp = client.post(f"/comments/{comment_id}/publish")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "published"
    assert body["externalCommentId"] == "ext-comment-SUR-1"
    assert body["errorMessage"] == ""

    assert any(c.get("ticket") == "SUR-1" and "body" in c for c in FakeAdapter.calls)
    assert any(c.get("ticket") == "SUR-1" and c.get("status") == "Passed" for c in FakeAdapter.calls)


def test_publish_all_and_selected(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session)
    client.post("/runs/1/comments/prepare")

    resp = client.post("/runs/1/comments/publish", json={"ticketIds": []})
    assert resp.status_code == 200
    statuses = {c["ticketExternalId"]: c["status"] for c in resp.json()}
    assert statuses == {"SUR-1": "published", "SUR-2": "published"}


def test_publish_failure_sets_failed_status_and_retry_recovers(client, db_session, monkeypatch):
    _patch_adapter_and_claude(monkeypatch)
    _seed_report(db_session, second_ticket_fails=True)
    client.post("/runs/1/comments/prepare")

    FakeAdapter.fail_tickets = {"SUR-2"}
    resp = client.post("/runs/1/comments/publish", json={"ticketIds": []})
    assert resp.status_code == 200
    statuses = {c["ticketExternalId"]: c["status"] for c in resp.json()}
    assert statuses["SUR-1"] == "published"
    assert statuses["SUR-2"] == "failed"

    failed_comment = next(c for c in resp.json() if c["ticketExternalId"] == "SUR-2")
    assert "upstream rejected" in failed_comment["errorMessage"]

    # Retry: unblock the ticket, then retry should recover it.
    FakeAdapter.fail_tickets = set()
    retry_resp = client.post("/runs/1/comments/retry")
    assert retry_resp.status_code == 200
    retried = retry_resp.json()
    assert len(retried) == 1
    assert retried[0]["ticketExternalId"] == "SUR-2"
    assert retried[0]["status"] == "published"


def test_publish_missing_provider_marks_failed(client, db_session, monkeypatch):
    from app.routers import comments as comments_router

    monkeypatch.setattr(
        comments_router.claude_cli, "run_prompt", lambda prompt, **k: f"QA summary: {prompt[:20]}..."
    )
    # No FakeAdapter patch, no Provider row seeded -> publish_service should fail cleanly.
    from app.models.report import Report
    from app.models.run import Run
    from app.models.ticket import Ticket

    db_session.add(Run(id=5, code="RUN-5", name="Run 5", status="comment"))
    db_session.add(Ticket(external_id="SUR-9", provider_kind="ado", title="No provider configured"))
    db_session.add(
        Report(
            run_id=5,
            execution_id=1,
            overall_result="passed",
            pass_rate=100.0,
            passed=1,
            failed=0,
            duration_s=1,
            env="Staging",
            data={
                "ticketSummary": [{"ticketExternalId": "SUR-9", "passed": 1, "failed": 0, "total": 1}],
                "aiFailureAnalysis": "",
            },
        )
    )
    db_session.commit()

    prepared = client.post("/runs/5/comments/prepare").json()
    resp = client.post(f"/comments/{prepared[0]['id']}/publish")
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"
    assert "not configured" in resp.json()["errorMessage"]
