"""Tests for the review router (app.routers.review)."""

from __future__ import annotations

from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.services import ai_service


def _make_run_with_case(db_session, ticket_external_id: str, *, code: str = "TC-01") -> tuple[Run, TestCase]:
    run = Run(code="RUN-300", name="Test run", status="review")
    db_session.add(run)
    db_session.flush()
    db_session.add(RunTicket(run_id=run.id, ticket_external_id=ticket_external_id, position=0))
    case = TestCase(
        run_id=run.id,
        ticket_external_id=ticket_external_id,
        code=code,
        title="Original title",
        precondition="Some precondition",
        steps=[{"a": "do thing", "e": "thing happens"}],
        priority="Medium",
        test_type="Functional",
        automation="Playwright",
        platform="Web",
        source="ai",
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(run)
    db_session.refresh(case)
    return run, case


def test_list_cases(client, db_session, seed_ticket):
    run, case = _make_run_with_case(db_session, seed_ticket.external_id)

    resp = client.get(f"/runs/{run.id}/cases")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == case.id


def test_list_cases_run_404(client):
    resp = client.get("/runs/999/cases")
    assert resp.status_code == 404


def test_create_manual_case(client, db_session, seed_ticket):
    run, _case = _make_run_with_case(db_session, seed_ticket.external_id)

    resp = client.post(
        f"/runs/{run.id}/cases",
        json={
            "ticketExternalId": seed_ticket.external_id,
            "title": "Manual case",
            "precondition": "Logged in",
            "steps": [{"a": "click button", "e": "modal opens"}],
            "priority": "Low",
            "testType": "Exploratory",
            "automation": "Manual",
            "platform": "Web",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "manual"
    assert body["code"] == "TC-02"  # increments past the existing TC-01
    assert body["title"] == "Manual case"


def test_update_case_sets_edited(client, db_session, seed_ticket):
    run, case = _make_run_with_case(db_session, seed_ticket.external_id)

    resp = client.patch(f"/cases/{case.id}", json={"title": "Updated title", "priority": "High"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Updated title"
    assert body["priority"] == "High"
    assert body["edited"] is True
    assert body["precondition"] == "Some precondition"  # untouched field preserved


def test_update_case_404(client):
    resp = client.patch("/cases/999", json={"title": "x"})
    assert resp.status_code == 404


def test_set_case_approval(client, db_session, seed_ticket):
    run, case = _make_run_with_case(db_session, seed_ticket.external_id)

    resp = client.post(f"/cases/{case.id}/approval", json={"approval": "approved"})
    assert resp.status_code == 200
    assert resp.json()["approval"] == "approved"

    resp = client.post(f"/cases/{case.id}/approval", json={"approval": "rejected"})
    assert resp.status_code == 200
    assert resp.json()["approval"] == "rejected"


def test_regenerate_single_case(client, db_session, seed_ticket, monkeypatch):
    run, case = _make_run_with_case(db_session, seed_ticket.external_id)

    improved = {
        "title": "Regenerated title",
        "precondition": "Regenerated precondition",
        "steps": [{"a": "new action", "e": "new expected"}],
        "priority": "High",
        "testType": "Negative",
        "automation": "Playwright",
        "platform": "Web",
    }
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: improved)

    resp = client.post(f"/cases/{case.id}/regenerate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == case.code  # code preserved
    assert body["title"] == "Regenerated title"
    assert body["edited"] is True


def test_regenerate_single_case_claude_error(client, db_session, seed_ticket, monkeypatch):
    from app.services.claude_cli import ClaudeError

    run, case = _make_run_with_case(db_session, seed_ticket.external_id)

    def _boom(*a, **k):
        raise ClaudeError("CLI unavailable")

    monkeypatch.setattr(ai_service, "run_json", _boom)

    resp = client.post(f"/cases/{case.id}/regenerate")
    assert resp.status_code == 502


def test_approve_all_skips_rejected(client, db_session, seed_ticket):
    run, case1 = _make_run_with_case(db_session, seed_ticket.external_id, code="TC-01")
    case2 = TestCase(
        run_id=run.id,
        ticket_external_id=seed_ticket.external_id,
        code="TC-02",
        title="Second case",
        approval="rejected",
    )
    db_session.add(case2)
    db_session.commit()

    resp = client.post(f"/runs/{run.id}/approve-all")
    assert resp.status_code == 200
    body = resp.json()
    by_code = {c["code"]: c for c in body}
    assert by_code["TC-01"]["approval"] == "approved"
    assert by_code["TC-02"]["approval"] == "rejected"  # untouched


def test_approve_ticket_cases(client, db_session, seed_ticket):
    run, case1 = _make_run_with_case(db_session, seed_ticket.external_id, code="TC-01")
    other_ticket_case = TestCase(
        run_id=run.id,
        ticket_external_id="SUR-9999",
        code="TC-01",
        title="Other ticket case",
    )
    db_session.add(other_ticket_case)
    db_session.commit()

    resp = client.post(f"/runs/{run.id}/tickets/{seed_ticket.external_id}/approve")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["ticketExternalId"] == seed_ticket.external_id
    assert body[0]["approval"] == "approved"

    # Other ticket's case untouched.
    other = client.get(f"/runs/{run.id}/cases").json()
    other_case = next(c for c in other if c["ticketExternalId"] == "SUR-9999")
    assert other_case["approval"] == "pending"
