"""Tests for evidence grouping and Pillow-based annotation."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


def _make_png(path: Path, size: tuple[int, int] = (100, 80)) -> None:
    Image.new("RGB", size, color=(10, 20, 30)).save(path, format="PNG")


def _seed_execution(db_session, run_id: int = 1):
    from app.models.execution import Execution, ExecutionResult
    from app.models.run import Run
    from app.models.ticket import Ticket

    run = Run(id=run_id, code="RUN-1", name="Run 1", status="evidence")
    db_session.add(run)

    ticket = Ticket(external_id="SUR-1", provider_kind="ado", title="Login works")
    db_session.add(ticket)
    db_session.flush()

    execution = Execution(run_id=run_id, status="done", total=2, passed=1, failed=1)
    db_session.add(execution)
    db_session.flush()

    pass_result = ExecutionResult(
        execution_id=execution.id,
        test_case_id=1,
        ticket_external_id="SUR-1",
        case_code="TC-01",
        title="Case 1",
        status="pass",
        duration_ms=500,
    )
    fail_result = ExecutionResult(
        execution_id=execution.id,
        test_case_id=2,
        ticket_external_id="SUR-1",
        case_code="TC-02",
        title="Case 2",
        status="fail",
        duration_ms=700,
        error_message="assertion failed",
    )
    db_session.add_all([pass_result, fail_result])
    db_session.flush()

    return execution, fail_result


def test_render_annotations_creates_output_file(tmp_path: Path):
    from app.schemas import AnnotationShape
    from app.services.annotate import render_annotations

    src = tmp_path / "shot.png"
    _make_png(src)
    dst = tmp_path / "shot-annotated.png"

    shapes = [
        AnnotationShape(tool="rectangle", x=5, y=5, w=20, h=15, color="#f43f5e"),
        AnnotationShape(tool="arrow", x=0, y=0, x2=50, y2=40, color="#22c55e"),
        AnnotationShape(tool="circle", x=10, y=10, w=30, h=30, color="#3b82f6"),
        AnnotationShape(tool="highlight", x=0, y=0, w=100, h=10, color="#eab308"),
        AnnotationShape(tool="text", x=2, y=2, text="broken here", color="#000000"),
    ]

    result_path = render_annotations(src, shapes, dst)

    assert result_path == dst
    assert dst.exists()
    with Image.open(dst) as img:
        assert img.size == (100, 80)


def test_get_run_evidence_groups_by_ticket(client, db_session):
    execution, _fail_result = _seed_execution(db_session)
    db_session.commit()

    resp = client.get("/runs/1/evidence")
    assert resp.status_code == 200
    body = resp.json()

    assert len(body["tickets"]) == 1
    ticket_summary = body["tickets"][0]
    assert ticket_summary["id"] == "SUR-1"
    assert ticket_summary["pass"] == 1
    assert ticket_summary["fail"] == 1
    assert ticket_summary["provGlyph"] == "AD"
    assert ticket_summary["statusLabel"] == "Failed"

    assert "SUR-1" in body["byTicket"]
    assert len(body["byTicket"]["SUR-1"]) == 2


def test_get_result_evidence_returns_list(client, db_session):
    from app.models.execution import Evidence

    _execution, fail_result = _seed_execution(db_session)
    evidence = Evidence(
        result_id=fail_result.id,
        kind="screenshot",
        path="shot.png",
        filename="shot.png",
        size_bytes=123,
    )
    db_session.add(evidence)
    db_session.commit()

    resp = client.get(f"/results/{fail_result.id}/evidence")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["kind"] == "screenshot"
    assert items[0]["annotated"] is False


def test_annotate_evidence_endpoint(client, db_session, workspace_dir: Path):
    from app.config import get_settings
    from app.models.execution import Evidence

    _execution, fail_result = _seed_execution(db_session)

    settings = get_settings()
    src_relpath = "run1/SUR-1/shot.png"
    src_path = settings.evidence_dir / src_relpath
    src_path.parent.mkdir(parents=True, exist_ok=True)
    _make_png(src_path)

    evidence = Evidence(
        result_id=fail_result.id,
        kind="screenshot",
        path=src_relpath,
        filename="shot.png",
        size_bytes=src_path.stat().st_size,
    )
    db_session.add(evidence)
    db_session.commit()
    db_session.refresh(evidence)

    resp = client.post(
        f"/evidence/{evidence.id}/annotate",
        json={"shapes": [{"tool": "rectangle", "x": 1, "y": 1, "w": 10, "h": 10, "color": "#ff0000"}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["annotated"] is True
    assert body["path"].endswith("-annotated.png")

    annotated_path = settings.evidence_dir / body["path"]
    assert annotated_path.exists()


def test_ticket_passed_only_when_all_approved_cases_pass(client, db_session):
    """A ticket is 'Passed' in Evidence only when every approved automatable
    case's script ran and passed — one passing case out of two is 'Pending'."""
    from app.models.execution import Execution, ExecutionResult
    from app.models.run import Run
    from app.models.testcase import TestCase
    from app.models.ticket import Ticket

    run = Run(id=88, code="RUN-88", name="Run 88", status="evidence")
    db_session.add(run)
    db_session.add(Ticket(external_id="SUR-9", provider_kind="ado", title="Broker list"))
    # Two approved, automatable cases on the ticket.
    for code in ("TC-01", "TC-02"):
        db_session.add(TestCase(run_id=88, ticket_external_id="SUR-9", code=code,
                                title=code, approval="approved", automation="Playwright"))
    execution = Execution(run_id=88, status="done", total=1, passed=1, failed=0)
    db_session.add(execution)
    db_session.flush()
    # Only ONE of the two approved cases actually ran (and passed).
    db_session.add(ExecutionResult(execution_id=execution.id, test_case_id=1,
                                   ticket_external_id="SUR-9", case_code="TC-01",
                                   title="TC-01", status="pass", duration_ms=100))
    db_session.commit()

    summary = client.get("/runs/88/evidence").json()["tickets"][0]
    assert summary["approved"] == 2
    assert summary["pass"] == 1
    assert summary["statusLabel"] == "Pending"  # not Passed — TC-02 hasn't passed

    # Run the second approved case successfully → now the ticket is Passed.
    db_session.add(ExecutionResult(execution_id=execution.id, test_case_id=2,
                                   ticket_external_id="SUR-9", case_code="TC-02",
                                   title="TC-02", status="pass", duration_ms=120))
    db_session.commit()
    db_session.expire_all()  # shared test session: force the endpoint to reload results
    summary2 = client.get("/runs/88/evidence").json()["tickets"][0]
    assert summary2["pass"] == 2
    assert summary2["statusLabel"] == "Passed"


# --------------------------------------------------------------- auto-annotation


def _seed_failed_screenshot(db_session):
    """A failed result with a real screenshot Evidence on disk."""
    from app.config import settings
    from app.models.execution import Evidence

    _execution, fail_result = _seed_execution(db_session, run_id=77)
    fail_result.error_message = 'expect(locator).toContainText("Activate") — not found'
    db_session.flush()

    rel = "RUN-77/SUR-1/TC-02/test-failed-1.png"
    abs_path = settings.evidence_dir / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (400, 300), (240, 240, 245)).save(abs_path)
    ev = Evidence(result_id=fail_result.id, kind="screenshot", path=rel,
                  filename="test-failed-1.png", size_bytes=abs_path.stat().st_size)
    db_session.add(ev)
    db_session.commit()
    db_session.refresh(ev)
    # A Run object for the service signature.
    from app.models.run import Run
    run = db_session.get(Run, 77)
    return run, fail_result, ev


def test_auto_annotate_burns_shapes_and_stores_diagnosis(db_session, monkeypatch):
    from app.config import settings
    from app.services import claude_cli, evidence_analysis

    run, result, ev = _seed_failed_screenshot(db_session)
    monkeypatch.setattr(
        claude_cli, "run_prompt",
        lambda *a, **k: '{"diagnosis":"The Activate action is missing from the menu",'
        '"shapes":[{"tool":"rectangle","x":10,"y":20,"w":40,"h":12,"color":"#f43f5e"},'
        '{"tool":"text","x":10,"y":6,"text":"missing option","color":"#f43f5e"}]}',
    )

    evidence_analysis.auto_annotate_result(db_session, run, result)
    db_session.refresh(ev)

    assert ev.annotated is True
    assert ev.meta["autoAnnotated"] is True
    assert "Activate action is missing" in ev.meta["diagnosis"]
    assert (settings.evidence_dir / ev.meta["annotatedPath"]).exists()


def test_auto_annotate_falls_back_to_caption_on_bad_json(db_session, monkeypatch):
    from app.config import settings
    from app.services import claude_cli, evidence_analysis

    run, result, ev = _seed_failed_screenshot(db_session)
    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: "sorry, I cannot help")

    evidence_analysis.auto_annotate_result(db_session, run, result)
    db_session.refresh(ev)

    assert ev.annotated is True
    assert ev.meta["diagnosis"]  # falls back to the error message
    assert (settings.evidence_dir / ev.meta["annotatedPath"]).exists()


def test_auto_annotate_endpoint(client, db_session, monkeypatch):
    from app.models.execution import Evidence
    from app.services import claude_cli

    _run, _result, ev = _seed_failed_screenshot(db_session)
    monkeypatch.setattr(
        claude_cli, "run_prompt",
        lambda *a, **k: '{"diagnosis":"Broken selector","shapes":[]}',
    )

    resp = client.post(f"/evidence/{ev.id}/auto-annotate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["annotated"] is True
    assert body["meta"]["diagnosis"] == "Broken selector"

    vid = Evidence(result_id=ev.result_id, kind="video", path="x.webm", filename="x.webm")
    db_session.add(vid)
    db_session.commit()
    assert client.post(f"/evidence/{vid.id}/auto-annotate").status_code == 400
    assert client.post("/evidence/999999/auto-annotate").status_code == 404
