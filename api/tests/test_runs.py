"""Tests for the runs router (app.routers.runs)."""

from __future__ import annotations

from app.routers import runs as runs_router
from app.services import ai_service
from app.services.skills import TEST_CASE_GENERATOR, TEST_CASE_REVIEWER

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


def _canned_run_json(*_args, **kwargs):
    """Return the right canned response per pipeline stage (keyed on the skill).

    Dispatching on ``skill`` (rather than call-count) keeps the mock stable
    across the three-call-per-ticket pipeline — analyze, generate, then the
    review coverage-expansion stage (#173) — including on regenerate.
    """
    skill = kwargs.get("skill")
    if skill == TEST_CASE_REVIEWER:
        return {"verdict": "approve", "coverageGaps": [], "additionalCases": []}
    if skill == TEST_CASE_GENERATOR:
        # The analyze+generate stages are merged into one call (#174).
        return {"analysis": CANNED_ANALYSIS, "cases": CANNED_CASES}
    return CANNED_ANALYSIS  # any other analysis-shaped call


def _patch_pipeline_blocking(monkeypatch):
    """Force POST /runs to run the pipeline synchronously so tests are deterministic."""
    monkeypatch.setattr(ai_service, "run_json", _canned_run_json)
    monkeypatch.setattr(
        runs_router,
        "run_generation_pipeline",
        lambda run_id, blocking=False: ai_service.run_generation_pipeline(run_id, blocking=True),
    )


def test_list_runs_carries_display_aggregates(client, db_session):
    """GET /runs enriches each run with caseCount + latest-execution passed/total
    + latest-report passRate (ADR: runs-list redesign)."""
    from app.models.execution import Execution
    from app.models.report import Report
    from app.models.run import Run
    from app.models.testcase import TestCase

    run = Run(code="RUN-700", name="Aggregates", scope="selected", status="done")
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    for i in range(3):
        db_session.add(
            TestCase(run_id=run.id, ticket_external_id="T-1", code=f"TC-0{i}", title=f"case {i}")
        )
    # Two executions — only the latest (higher id) should be reflected.
    db_session.add(Execution(run_id=run.id, status="done", total=5, passed=1, failed=4))
    db_session.add(Execution(run_id=run.id, status="done", total=7, passed=7, failed=0))
    db_session.add(Report(run_id=run.id, overall_result="passed", pass_rate=96.0, passed=7, failed=0))
    db_session.commit()

    resp = client.get("/runs")
    assert resp.status_code == 200
    row = next(r for r in resp.json() if r["code"] == "RUN-700")
    assert row["caseCount"] == 3
    assert row["total"] == 7  # latest execution, not the earlier 5
    assert row["passed"] == 7
    assert row["passRate"] == 96.0


def test_list_runs_aggregates_default_when_no_data(client, db_session):
    """A run with no cases/executions/reports reports zeroed aggregates + null rate."""
    from app.models.run import Run

    run = Run(code="RUN-701", name="Bare", scope="selected", status="processing")
    db_session.add(run)
    db_session.commit()

    row = next(r for r in client.get("/runs").json() if r["code"] == "RUN-701")
    assert row["caseCount"] == 0
    assert row["total"] == 0
    assert row["passed"] == 0
    assert row["passRate"] is None


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
