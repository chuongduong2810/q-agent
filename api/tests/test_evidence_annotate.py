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
