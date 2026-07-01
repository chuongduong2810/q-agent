"""Tests for the automation generation router + spec_service.

Monkeypatches ``app.services.claude_cli.run_prompt`` to return a canned spec
string so no real Claude CLI is invoked, per ADR 0001's test guidance ("tests
may mock transport to exercise our own logic").
"""

from __future__ import annotations

import time

CANNED_SPEC = """```typescript
import { test, expect } from '@playwright/test';

test('Login works', async ({ page }) => {
  await page.goto('https://example.com/login');
  await expect(page).toHaveTitle(/Login/);
});
```"""


_run_counter = 0


def _seed_run_and_case(db_session, *, automation="Playwright", approval="approved"):
    global _run_counter
    _run_counter += 1
    from app.models.run import Run

    run = Run(code=f"RUN-{_run_counter}", name="Test run", status="review")
    db_session.add(run)
    db_session.flush()

    from app.models.testcase import TestCase

    case = TestCase(
        run_id=run.id,
        ticket_external_id="SUR-1428",
        code="TC-01",
        title="Login works",
        precondition="User is on the login page",
        steps=[{"a": "Enter valid credentials", "e": "User is logged in"}],
        approval=approval,
        automation=automation,
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(run)
    db_session.refresh(case)
    return run, case


def test_generate_writes_spec_file_and_persists_row(client, db_session, monkeypatch):
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    run, case = _seed_run_and_case(db_session)

    resp = client.post(f"/runs/{run.id}/automation/generate")
    assert resp.status_code == 200

    # Generation runs in a background thread; wait for it to finish.
    for _ in range(50):
        time.sleep(0.05)
        specs = client.get(f"/runs/{run.id}/automation").json()
        if specs:
            break
    else:
        specs = client.get(f"/runs/{run.id}/automation").json()

    assert len(specs) == 1
    spec = specs[0]
    assert spec["testCaseId"] == case.id
    assert spec["filename"] == "1428-TC-01.spec.ts"
    assert "test('Login works'" in spec["code"]
    assert spec["language"] == "TypeScript"
    assert spec["framework"] == "Playwright"

    from app.config import settings

    spec_path = settings.specs_dir / run.code / "1428-TC-01.spec.ts"
    assert spec_path.exists()
    assert "test('Login works'" in spec_path.read_text(encoding="utf-8")

    from app.db import SessionLocal
    from app.models.testcase import AutomationSpec

    db = SessionLocal()
    try:
        row = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
        assert row is not None
        assert row.path == str(spec_path)
    finally:
        db.close()


def test_generate_skips_manual_and_unapproved_cases(client, db_session, monkeypatch):
    from app.services import claude_cli

    calls = []
    monkeypatch.setattr(
        claude_cli, "run_prompt", lambda *a, **k: calls.append(1) or CANNED_SPEC
    )

    run, _approved_playwright_case = _seed_run_and_case(db_session)
    _manual_run, manual_case = _seed_run_and_case(db_session, automation="Manual")
    _pending_run, pending_case = _seed_run_and_case(db_session, approval="pending")

    resp = client.post(f"/runs/{run.id}/automation/generate")
    assert resp.status_code == 200

    time.sleep(0.3)  # background thread completes quickly for a single case

    specs = client.get(f"/runs/{run.id}/automation").json()
    assert len(specs) == 1

    assert client.get(f"/cases/{manual_case.id}/spec").status_code == 404
    assert client.get(f"/cases/{pending_case.id}/spec").status_code == 404


def test_get_case_spec_and_regenerate(client, db_session, monkeypatch):
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    run, case = _seed_run_and_case(db_session)

    resp = client.post(f"/cases/{case.id}/spec/regenerate")
    assert resp.status_code == 200
    body = resp.json()
    assert body["testCaseId"] == case.id
    assert body["filename"] == "1428-TC-01.spec.ts"

    resp2 = client.get(f"/cases/{case.id}/spec")
    assert resp2.status_code == 200
    assert resp2.json()["id"] == body["id"]


def test_generate_missing_run_returns_404(client, db_session):
    resp = client.post("/runs/9999/automation/generate")
    assert resp.status_code == 404


def test_spec_service_generate_spec_code_extracts_fenced_typescript(monkeypatch):
    from app.services import claude_cli, spec_service
    from app.models.testcase import TestCase

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    case = TestCase(
        run_id=1,
        ticket_external_id="SUR-1428",
        code="TC-01",
        title="Login works",
        precondition="",
        steps=[],
    )
    code = spec_service.generate_spec_code(case)
    assert code.startswith("import { test, expect }")
    assert "```" not in code


def test_spec_filename_strips_ticket_prefix():
    from app.services import spec_service

    assert spec_service.spec_filename("SUR-1428", "TC-01") == "1428-TC-01.spec.ts"
