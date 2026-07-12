"""Tests for run lifecycle — cancel / retry / delete (ADR 0005)."""

from __future__ import annotations

from app.models.claude_usage import ClaudeUsage
from app.models.comment import TicketComment
from app.models.execution import Evidence, Execution, ExecutionResult
from app.models.linked import LinkedTestCase
from app.models.report import Report
from app.models.run import Run, RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.routers import runs as runs_router
from app.services import link_service
from app.services.run_status import recover_orphaned_runs, set_run_status


def _make_run(db_session, *, code: str, status: str = "executing", **kwargs) -> Run:
    run = Run(code=code, name="Test run", status=status, **kwargs)
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


# --------------------------------------------------------------------- cancel


def test_cancel_sets_cancelled_and_terminal_guard(client, db_session):
    run = _make_run(db_session, status="executing", code="RUN-901")

    resp = client.post(f"/runs/{run.id}/cancel")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "cancelled"
    # The response must expose the cancel/finish timestamps (RunOut serialization).
    assert body["cancelledAt"] is not None
    assert body["finishedAt"] is not None

    db_session.refresh(run)
    assert run.status == "cancelled"
    assert run.cancel_requested is True
    assert run.cancelled_at is not None
    assert run.finished_at is not None

    # Terminal-guard invariant: a worker "finishing" a stage after cancel must
    # never resurrect the run into an in-progress status.
    advanced = set_run_status(db_session, run, "evidence")
    assert advanced is False
    db_session.refresh(run)
    assert run.status == "cancelled"


def test_cancel_on_terminal_run_returns_409(client, db_session):
    run = _make_run(db_session, status="done", code="RUN-902")
    resp = client.post(f"/runs/{run.id}/cancel")
    assert resp.status_code == 409


def test_cancel_unknown_run_404(client):
    resp = client.post("/runs/999999/cancel")
    assert resp.status_code == 404


# ---------------------------------------------------------------------- retry


def test_retry_resumes_from_failed_stage_sync(client, db_session, monkeypatch):
    run = _make_run(db_session, status="failed", failed_stage="sync", code="RUN-903")

    calls = []

    def fake_start_create_link(run_id, link, ticket_ids, dry_run=False):
        calls.append((run_id, link, ticket_ids, dry_run))

    monkeypatch.setattr(link_service, "start_create_link", fake_start_create_link)

    resp = client.post(f"/runs/{run.id}/retry")
    assert resp.status_code == 200
    assert resp.json()["status"] == "sync"
    assert calls == [(run.id, True, None, False)]

    db_session.refresh(run)
    assert run.cancel_requested is False
    assert run.cancelled_at is None
    assert run.finished_at is None
    assert run.failed_stage is None


def test_retry_unknown_failed_stage_falls_back_to_processing(client, db_session, monkeypatch):
    run = _make_run(db_session, status="cancelled", failed_stage=None, code="RUN-904")

    calls = []
    monkeypatch.setattr(
        runs_router, "run_generation_pipeline", lambda run_id, blocking=False: calls.append(run_id)
    )

    resp = client.post(f"/runs/{run.id}/retry")
    assert resp.status_code == 200
    assert resp.json()["status"] == "processing"
    assert calls == [run.id]


def test_retry_on_non_terminal_run_returns_409(client, db_session):
    run = _make_run(db_session, status="executing", code="RUN-905")
    resp = client.post(f"/runs/{run.id}/retry")
    assert resp.status_code == 409


def test_retry_unknown_run_404(client):
    resp = client.post("/runs/999999/retry")
    assert resp.status_code == 404


# --------------------------------------------------------------------- delete


def test_delete_removes_related_rows(client, db_session):
    run = _make_run(db_session, status="done", code="RUN-906")

    case = TestCase(run_id=run.id, ticket_external_id="T-1", code="TC-01", title="t")
    run_ticket = RunTicket(run_id=run.id, ticket_external_id="T-1")
    db_session.add_all([case, run_ticket])
    db_session.commit()
    db_session.refresh(case)

    spec = AutomationSpec(test_case_id=case.id, filename="f.spec.ts")
    execution = Execution(run_id=run.id, status="done")
    db_session.add_all([spec, execution])
    db_session.commit()
    db_session.refresh(execution)

    result = ExecutionResult(
        execution_id=execution.id, test_case_id=case.id,
        ticket_external_id="T-1", case_code="TC-01", title="t",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)

    evidence = Evidence(result_id=result.id, kind="screenshot")
    report = Report(run_id=run.id)
    comment = TicketComment(run_id=run.id, ticket_external_id="T-1", provider_kind="ado")
    usage = ClaudeUsage(run_id=run.id)
    linked = LinkedTestCase(
        run_id=run.id, ticket_external_id="T-1", provider_kind="ado",
        external_id="X-1", title="t",
    )
    db_session.add_all([evidence, report, comment, usage, linked])
    db_session.commit()
    linked_id = linked.id

    resp = client.delete(f"/runs/{run.id}")
    assert resp.status_code == 204

    assert db_session.get(Run, run.id) is None
    assert db_session.query(RunTicket).filter(RunTicket.run_id == run.id).count() == 0
    assert db_session.query(TestCase).filter(TestCase.run_id == run.id).count() == 0
    assert db_session.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).count() == 0
    assert db_session.query(Execution).filter(Execution.run_id == run.id).count() == 0
    assert (
        db_session.query(ExecutionResult).filter(ExecutionResult.execution_id == execution.id).count() == 0
    )
    assert db_session.query(Evidence).filter(Evidence.result_id == result.id).count() == 0
    assert db_session.query(Report).filter(Report.run_id == run.id).count() == 0
    assert db_session.query(TicketComment).filter(TicketComment.run_id == run.id).count() == 0
    assert db_session.query(ClaudeUsage).filter(ClaudeUsage.run_id == run.id).count() == 0

    # Linked test cases are kept but detached, not deleted.
    remaining_run_id = (
        db_session.query(LinkedTestCase.run_id).filter(LinkedTestCase.id == linked_id).scalar()
    )
    assert db_session.query(LinkedTestCase).filter(LinkedTestCase.id == linked_id).count() == 1
    assert remaining_run_id is None


def test_delete_in_progress_run_returns_409(client, db_session):
    run = _make_run(db_session, status="executing", code="RUN-907")
    resp = client.delete(f"/runs/{run.id}")
    assert resp.status_code == 409


def test_delete_unknown_run_404(client):
    resp = client.delete("/runs/999999")
    assert resp.status_code == 404


# ------------------------------------------------------- orphaned-run recovery


def test_recover_orphaned_runs_fails_active_work_leaves_review_alone(db_session):
    processing_run = _make_run(db_session, status="processing", code="RUN-908")
    review_run = _make_run(db_session, status="review", code="RUN-909")

    recovered = recover_orphaned_runs(db_session)
    assert recovered == 1

    db_session.refresh(processing_run)
    assert processing_run.status == "failed"
    assert processing_run.failed_stage == "processing"
    assert processing_run.finished_at is not None

    db_session.refresh(review_run)
    assert review_run.status == "review"
    assert review_run.failed_stage is None
    assert review_run.finished_at is None
