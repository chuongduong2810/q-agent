"""Tests for the runs router (app.routers.runs)."""

from __future__ import annotations

from app.routers import runs as runs_router
from app.services import ai_service

CANNED_ANALYSIS = {
    "businessRules": ["Reset link must be single-use"],
    "functionalRequirements": ["Send reset email on request"],
    "validationRules": ["Email must be a valid format"],
    "risks": ["Link reuse after password change"],
    "edgeCases": ["Expired link clicked"],
    "missingInformation": [],
    "suggestedScope": "Cover reset request and link expiry.",
}

CANNED_CASES = [
    {
        "title": "Request reset link with valid email",
        "precondition": "User has a registered account",
        "steps": [{"a": "Submit valid email", "e": "Reset email is sent"}],
        "priority": "High",
        "testType": "Functional",
        "automation": "Playwright",
        "platform": "Web",
    },
]


def _canned_run_json(*_args, **_kwargs):
    """Alternate between analysis and cases responses across calls."""
    _canned_run_json.calls += 1
    return CANNED_ANALYSIS if _canned_run_json.calls % 2 == 1 else CANNED_CASES


_canned_run_json.calls = 0


def _patch_pipeline_blocking(monkeypatch):
    """Force POST /runs to run the pipeline synchronously so tests are deterministic."""
    monkeypatch.setattr(ai_service, "run_json", _canned_run_json)
    monkeypatch.setattr(
        runs_router,
        "run_generation_pipeline",
        lambda run_id, blocking=False: ai_service.run_generation_pipeline(run_id, blocking=True),
    )


def test_create_run_returns_detail_and_generates_cases(client, seed_ticket, monkeypatch):
    _patch_pipeline_blocking(monkeypatch)

    resp = client.post("/runs", json={"scope": "selected", "ticketIds": [seed_ticket.external_id]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == "RUN-200"
    assert body["status"] == "review"  # pipeline ran synchronously and completed
    assert body["ticketIds"] == [seed_ticket.external_id]
    assert len(body["runTickets"]) == 1
    assert body["runTickets"][0]["genStatus"] == "done"

    cases_resp = client.get(f"/runs/{body['id']}/cases")
    assert cases_resp.status_code == 200
    assert len(cases_resp.json()) == 1


def test_create_run_rejects_empty_ticket_ids(client):
    resp = client.post("/runs", json={"scope": "selected", "ticketIds": []})
    assert resp.status_code == 400


def test_list_runs(client, seed_ticket, monkeypatch):
    _patch_pipeline_blocking(monkeypatch)
    client.post("/runs", json={"ticketIds": [seed_ticket.external_id]})

    resp = client.get("/runs")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_get_run_404(client):
    resp = client.get("/runs/999")
    assert resp.status_code == 404


def test_get_run_tickets(client, seed_ticket, monkeypatch):
    _patch_pipeline_blocking(monkeypatch)
    created = client.post("/runs", json={"ticketIds": [seed_ticket.external_id]}).json()

    resp = client.get(f"/runs/{created['id']}/tickets")
    assert resp.status_code == 200
    tickets = resp.json()
    assert len(tickets) == 1
    assert tickets[0]["ticketExternalId"] == seed_ticket.external_id
    assert tickets[0]["analysis"]["suggestedScope"] == CANNED_ANALYSIS["suggestedScope"]


def test_regenerate_run_clears_and_regenerates_cases(client, seed_ticket, monkeypatch):
    _patch_pipeline_blocking(monkeypatch)
    created = client.post("/runs", json={"ticketIds": [seed_ticket.external_id]}).json()
    run_id = created["id"]

    first_cases = client.get(f"/runs/{run_id}/cases").json()
    assert len(first_cases) == 1

    resp = client.post(f"/runs/{run_id}/regenerate")
    assert resp.status_code == 200
    assert resp.json()["status"] == "review"

    cases = client.get(f"/runs/{run_id}/cases").json()
    assert len(cases) == 1  # regenerated fresh, not doubled
    assert cases[0]["code"] == "TC-01"


def test_next_run_code_increments(client, seed_ticket, monkeypatch):
    _patch_pipeline_blocking(monkeypatch)
    first = client.post("/runs", json={"ticketIds": [seed_ticket.external_id]}).json()
    second = client.post("/runs", json={"ticketIds": [seed_ticket.external_id]}).json()

    assert first["code"] == "RUN-200"
    assert second["code"] == "RUN-201"
