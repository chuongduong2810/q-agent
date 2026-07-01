"""Tests for the execution router + playwright_runner.

The real Playwright subprocess is monkeypatched out (``_invoke_playwright``)
so no browser is required; ``parse_playwright_report`` — the pure mapping
function — is exercised directly and via a monkeypatched runner.
"""

from __future__ import annotations

import time

from app.services.playwright_runner import parse_playwright_report

SAMPLE_REPORT = {
    "suites": [
        {
            "title": "1428-TC-01.spec.ts",
            "file": "1428-TC-01.spec.ts",
            "specs": [
                {
                    "title": "Login works",
                    "ok": True,
                    "file": "1428-TC-01.spec.ts",
                    "tests": [
                        {
                            "status": "expected",
                            "results": [
                                {
                                    "status": "passed",
                                    "duration": 123,
                                    "errors": [],
                                    "attachments": [],
                                }
                            ],
                        }
                    ],
                }
            ],
            "suites": [],
        },
        {
            "title": "1428-TC-02.spec.ts",
            "file": "1428-TC-02.spec.ts",
            "specs": [
                {
                    "title": "Logout works",
                    "ok": False,
                    "file": "1428-TC-02.spec.ts",
                    "tests": [
                        {
                            "status": "unexpected",
                            "results": [
                                {
                                    "status": "failed",
                                    "duration": 456,
                                    "error": {"message": "Timed out waiting for selector"},
                                    "attachments": [
                                        {
                                            "name": "screenshot",
                                            "contentType": "image/png",
                                            "path": "/tmp/test-results/foo/test-failed-1.png",
                                        },
                                        {
                                            "name": "trace",
                                            "contentType": "application/zip",
                                            "path": "/tmp/test-results/foo/trace.zip",
                                        },
                                        {
                                            "name": "error-context",
                                            "contentType": "text/markdown",
                                            "path": "/tmp/test-results/foo/error-context.md",
                                        },
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
            "suites": [],
        },
    ]
}


def test_parse_playwright_report_maps_pass_and_fail():
    results = parse_playwright_report(SAMPLE_REPORT)
    assert len(results) == 2

    passed = next(r for r in results if r["file"] == "1428-TC-01.spec.ts")
    assert passed["status"] == "pass"
    assert passed["duration_ms"] == 123
    assert passed["error_message"] == ""
    assert passed["attachments"] == []

    failed = next(r for r in results if r["file"] == "1428-TC-02.spec.ts")
    assert failed["status"] == "fail"
    assert failed["duration_ms"] == 456
    assert failed["error_message"] == "Timed out waiting for selector"
    # error-context.md is not a known evidence kind and should be dropped.
    kinds = {a["kind"] for a in failed["attachments"]}
    assert kinds == {"screenshot", "trace"}


def test_parse_playwright_report_empty_suites_returns_empty_list():
    assert parse_playwright_report({"suites": []}) == []


def test_parse_playwright_report_uses_last_retry_result():
    report = {
        "suites": [
            {
                "title": "x.spec.ts",
                "file": "x.spec.ts",
                "specs": [
                    {
                        "title": "flaky test",
                        "file": "x.spec.ts",
                        "tests": [
                            {
                                "status": "expected",
                                "results": [
                                    {"status": "failed", "duration": 10, "attachments": []},
                                    {"status": "passed", "duration": 20, "attachments": []},
                                ],
                            }
                        ],
                    }
                ],
                "suites": [],
            }
        ]
    }
    results = parse_playwright_report(report)
    assert len(results) == 1
    assert results[0]["status"] == "pass"
    assert results[0]["duration_ms"] == 20


def _seed_run_with_approved_case(db_session):
    from app.models.run import Run
    from app.models.testcase import TestCase

    run = Run(code="RUN-1", name="Test run", status="automation", workers=2)
    db_session.add(run)
    db_session.flush()

    case = TestCase(
        run_id=run.id,
        ticket_external_id="SUR-1428",
        code="TC-01",
        title="Login works",
        approval="approved",
        automation="Playwright",
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(run)
    db_session.refresh(case)
    return run, case


def test_start_execution_creates_execution_and_pending_results(client, db_session, monkeypatch):
    import app.services.playwright_runner as runner_module

    # Prevent the background thread from doing real subprocess/file work; we
    # only assert on what POST /runs/{id}/execution creates synchronously.
    monkeypatch.setattr(runner_module, "run_execution", lambda execution_id: None)

    run, case = _seed_run_with_approved_case(db_session)

    resp = client.post(f"/runs/{run.id}/execution", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["runId"] == run.id
    assert body["status"] == "running"
    assert body["total"] == 1
    assert len(body["results"]) == 1
    assert body["results"][0]["testCaseId"] == case.id
    assert body["results"][0]["status"] == "pending"

    from app.db import SessionLocal
    from app.models.run import Run

    db = SessionLocal()
    try:
        refreshed_run = db.get(Run, run.id)
        assert refreshed_run.status == "executing"
    finally:
        db.close()


def test_start_execution_no_eligible_cases_returns_400(client, db_session):
    from app.models.run import Run

    run = Run(code="RUN-2", name="Empty run", status="review")
    db_session.add(run)
    db_session.commit()

    resp = client.post(f"/runs/{run.id}/execution", json={})
    assert resp.status_code == 400


def test_start_execution_missing_run_returns_404(client):
    resp = client.post("/runs/9999/execution", json={})
    assert resp.status_code == 404


def test_get_latest_execution_and_by_id(client, db_session, monkeypatch):
    import app.services.playwright_runner as runner_module

    monkeypatch.setattr(runner_module, "run_execution", lambda execution_id: None)

    run, _case = _seed_run_with_approved_case(db_session)
    created = client.post(f"/runs/{run.id}/execution", json={}).json()

    latest = client.get(f"/runs/{run.id}/execution")
    assert latest.status_code == 200
    assert latest.json()["id"] == created["id"]

    by_id = client.get(f"/executions/{created['id']}")
    assert by_id.status_code == 200
    assert by_id.json()["id"] == created["id"]

    assert client.get("/executions/9999").status_code == 404
    assert client.get("/runs/9999/execution").status_code == 404


def test_run_execution_end_to_end_with_mocked_subprocess(client, db_session, monkeypatch, tmp_path):
    """Full run_execution() pass: mock _invoke_playwright + write a canned report.json."""
    import app.services.playwright_runner as runner_module

    run, case = _seed_run_with_approved_case(db_session)

    from app.config import settings

    spec_dir = settings.specs_dir / run.code
    spec_dir.mkdir(parents=True, exist_ok=True)

    # A screenshot file the parser's evidence-copy step can actually find.
    fake_screenshot = tmp_path / "test-failed-1.png"
    fake_screenshot.write_bytes(b"fake-png-bytes")

    report = {
        "suites": [
            {
                "title": "1428-TC-01.spec.ts",
                "file": "1428-TC-01.spec.ts",
                "specs": [
                    {
                        "title": "Login works",
                        "file": "1428-TC-01.spec.ts",
                        "tests": [
                            {
                                "results": [
                                    {
                                        "status": "passed",
                                        "duration": 99,
                                        "attachments": [
                                            {
                                                "name": "screenshot",
                                                "contentType": "image/png",
                                                "path": str(fake_screenshot),
                                            }
                                        ],
                                    }
                                ]
                            }
                        ],
                    }
                ],
                "suites": [],
            }
        ]
    }

    def fake_invoke(spec_dir_arg, workers, timeout_s):
        import json as _json

        (spec_dir_arg / "report.json").write_text(_json.dumps(report), encoding="utf-8")
        return 0, "", ""

    monkeypatch.setattr(runner_module, "_invoke_playwright", fake_invoke)

    resp = client.post(f"/runs/{run.id}/execution", json={})
    assert resp.status_code == 200
    execution_id = resp.json()["id"]

    for _ in range(50):
        time.sleep(0.05)
        current = client.get(f"/executions/{execution_id}").json()
        if current["status"] == "done":
            break
    else:
        current = client.get(f"/executions/{execution_id}").json()

    assert current["status"] == "done"
    assert current["passed"] == 1
    assert current["failed"] == 0
    result = current["results"][0]
    assert result["status"] == "pass"
    assert result["durationMs"] == 99
    assert len(result["evidence"]) == 1
    assert result["evidence"][0]["kind"] == "screenshot"

    from app.db import SessionLocal
    from app.models.run import Run

    db = SessionLocal()
    try:
        refreshed_run = db.get(Run, run.id)
        assert refreshed_run.status == "evidence"
    finally:
        db.close()
