"""Tests for report aggregation math and endpoints."""

from __future__ import annotations

import pytest


def _seed_execution(db_session, run_id: int = 1):
    from app.models.execution import Execution, ExecutionResult
    from app.models.run import Run
    from app.models.ticket import Ticket

    run = Run(id=run_id, code="RUN-1", name="Run 1", status="evidence")
    db_session.add(run)
    db_session.add(Ticket(external_id="SUR-1", provider_kind="ado", title="Login works"))
    db_session.flush()

    execution = Execution(run_id=run_id, status="done", env="Staging")
    db_session.add(execution)
    db_session.flush()

    results = [
        ExecutionResult(
            execution_id=execution.id,
            test_case_id=1,
            ticket_external_id="SUR-1",
            case_code="TC-01",
            title="Case 1",
            status="pass",
            duration_ms=1000,
        ),
        ExecutionResult(
            execution_id=execution.id,
            test_case_id=2,
            ticket_external_id="SUR-1",
            case_code="TC-02",
            title="Case 2",
            status="pass",
            duration_ms=2000,
        ),
        ExecutionResult(
            execution_id=execution.id,
            test_case_id=3,
            ticket_external_id="SUR-1",
            case_code="TC-03",
            title="Case 3",
            status="fail",
            duration_ms=1500,
            error_message="timeout waiting for selector",
        ),
    ]
    db_session.add_all(results)
    db_session.commit()
    return execution


def test_build_report_aggregation_math(db_session, monkeypatch):
    from app.services import report_service

    monkeypatch.setattr(
        report_service.claude_cli, "run_prompt", lambda *a, **k: "Likely a flaky selector timeout."
    )

    _seed_execution(db_session)
    report = report_service.build_report(db_session, run_id=1)

    assert report.passed == 2
    assert report.failed == 1
    assert report.pass_rate == pytest.approx(66.7, abs=0.1)
    assert report.duration_s == 4  # (1000+2000+1500)ms = 4.5s -> round-half-to-even -> 4
    assert report.overall_result == "failed"
    assert report.env == "Staging"

    ticket_summary = report.data["ticketSummary"]
    assert ticket_summary == [{"ticketExternalId": "SUR-1", "passed": 2, "failed": 1, "total": 3}]
    assert "flaky selector timeout" in report.data["aiFailureAnalysis"]


def test_build_report_all_pass_no_claude_call(db_session, monkeypatch):
    from app.models.execution import Execution, ExecutionResult
    from app.models.run import Run
    from app.services import report_service

    called = False

    def _fail_if_called(*a, **k):
        nonlocal called
        called = True
        return "should not be called"

    monkeypatch.setattr(report_service.claude_cli, "run_prompt", _fail_if_called)

    db_session.add(Run(id=2, code="RUN-2", name="Run 2", status="evidence"))
    db_session.flush()
    execution = Execution(run_id=2, status="done", env="Prod")
    db_session.add(execution)
    db_session.flush()
    db_session.add(
        ExecutionResult(
            execution_id=execution.id,
            test_case_id=1,
            ticket_external_id="SUR-2",
            case_code="TC-01",
            title="Case 1",
            status="pass",
            duration_ms=1000,
        )
    )
    db_session.commit()

    report = report_service.build_report(db_session, run_id=2)

    assert called is False
    assert report.overall_result == "passed"
    assert report.data["aiFailureAnalysis"] == ""


def test_build_report_claude_error_is_captured_not_raised(db_session, monkeypatch):
    from app.services import report_service
    from app.services.claude_cli import ClaudeError

    def _raise(*a, **k):
        raise ClaudeError("CLI not authenticated")

    monkeypatch.setattr(report_service.claude_cli, "run_prompt", _raise)

    _seed_execution(db_session)
    report = report_service.build_report(db_session, run_id=1)

    assert "AI failure analysis unavailable" in report.data["aiFailureAnalysis"]


def test_report_endpoints(client, db_session, monkeypatch):
    from app.services import report_service

    monkeypatch.setattr(report_service.claude_cli, "run_prompt", lambda *a, **k: "analysis text")
    _seed_execution(db_session)

    resp = client.post("/runs/1/report")
    assert resp.status_code == 200
    body = resp.json()
    assert body["runId"] == 1
    assert body["passed"] == 2
    assert body["failed"] == 1

    resp_get = client.get("/runs/1/report")
    assert resp_get.status_code == 200
    assert resp_get.json()["id"] == body["id"]

    resp_list = client.get("/reports")
    assert resp_list.status_code == 200
    assert len(resp_list.json()) == 1


def test_get_report_404_when_missing(client):
    resp = client.get("/runs/999/report")
    assert resp.status_code == 404
