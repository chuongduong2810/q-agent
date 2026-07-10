"""Tests for the sample-run seeder (POST /runs/sample + sample_run_service)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.routers import runs as runs_router
from app.services import ai_service, sample_run_service


def _counts(db_session, run_id: int) -> dict[str, int]:
    """Row counts for the demo run's populated stages, for stability assertions."""
    from app.models.comment import TicketComment
    from app.models.execution import Evidence, Execution, ExecutionResult
    from app.models.linked import LinkedTestCase
    from app.models.report import Report
    from app.models.testcase import AutomationSpec, TestCase

    exec_ids = [
        e.id for e in db_session.query(Execution).filter(Execution.run_id == run_id).all()
    ]
    result_ids = (
        [r.id for r in db_session.query(ExecutionResult)
         .filter(ExecutionResult.execution_id.in_(exec_ids)).all()]
        if exec_ids
        else []
    )
    case_ids = [c.id for c in db_session.query(TestCase).filter(TestCase.run_id == run_id).all()]
    return {
        "cases": len(case_ids),
        "specs": db_session.query(AutomationSpec)
        .filter(AutomationSpec.test_case_id.in_(case_ids))
        .count()
        if case_ids
        else 0,
        "links": db_session.query(LinkedTestCase)
        .filter(LinkedTestCase.run_id == run_id)
        .count(),
        "executions": len(exec_ids),
        "results": len(result_ids),
        "evidence": db_session.query(Evidence)
        .filter(Evidence.result_id.in_(result_ids))
        .count()
        if result_ids
        else 0,
        "reports": db_session.query(Report).filter(Report.run_id == run_id).count(),
        "comments": db_session.query(TicketComment)
        .filter(TicketComment.run_id == run_id)
        .count(),
    }


def test_create_sample_run_populates_every_stage(client, db_session, monkeypatch):
    """POST /runs/sample returns a terminal `done` run with the full row graph,
    and the AI generation pipeline is never invoked."""
    spy = MagicMock()
    monkeypatch.setattr(ai_service, "run_generation_pipeline", spy)
    monkeypatch.setattr(runs_router, "run_generation_pipeline", spy)

    resp = client.post("/runs/sample")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == sample_run_service.DEMO_RUN_CODE
    assert body["status"] == "done"
    assert len(body["runTickets"]) == len(sample_run_service.DEMO_TICKET_IDS)

    counts = _counts(db_session, body["id"])
    assert counts["cases"] > 0
    assert counts["specs"] > 0
    assert counts["links"] > 0
    assert counts["executions"] == 1
    assert counts["results"] > 0
    assert counts["evidence"] > 0  # placeholder screenshots + video/trace
    assert counts["reports"] == 1
    assert counts["comments"] == len(sample_run_service.DEMO_TICKET_IDS)

    # A run that populates the Evidence screen has exactly one failing result.
    from app.models.execution import ExecutionResult

    failed = (
        db_session.query(ExecutionResult)
        .filter(ExecutionResult.status == "fail")
        .count()
    )
    assert failed == 1

    spy.assert_not_called()


def test_create_sample_run_is_idempotent(client, db_session, monkeypatch):
    """A second POST returns the SAME run id and does not duplicate any rows."""
    monkeypatch.setattr(ai_service, "run_generation_pipeline", MagicMock())
    monkeypatch.setattr(runs_router, "run_generation_pipeline", MagicMock())

    first = client.post("/runs/sample").json()
    counts_first = _counts(db_session, first["id"])

    second = client.post("/runs/sample").json()
    assert second["id"] == first["id"]
    assert _counts(db_session, second["id"]) == counts_first

    from app.models.run import Run

    assert (
        db_session.query(Run)
        .filter(Run.code == sample_run_service.DEMO_RUN_CODE)
        .count()
        == 1
    )
