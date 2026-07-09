"""Tests for the automation generation router + spec_service.

Monkeypatches ``app.services.claude_cli.run_prompt`` to return a canned spec
string so no real Claude CLI is invoked, per ADR 0001's test guidance ("tests
may mock transport to exercise our own logic").
"""

from __future__ import annotations

import time

import pytest

CANNED_SPEC = """```typescript
import { test, expect } from '@playwright/test';

test('Login works', async ({ page }) => {
  await page.goto('https://example.com/login');
  await expect(page).toHaveTitle(/Login/);
});
```"""


_run_counter = 0


@pytest.fixture(autouse=True)
def _clear_heal_state():
    """Heal state (``playwright_runner._healing``) is module-global; fresh test
    DBs reuse case id 1, so clear it between tests to prevent cross-test bleed."""
    from app.services import playwright_runner

    playwright_runner._healing.clear()
    yield
    playwright_runner._healing.clear()


@pytest.fixture(autouse=True)
def _stub_external_gates(monkeypatch):
    """Keep generation/heal deterministic + fast.

    Two wiring points call real external tools: the ``playwright test --list`` parse
    gate (a subprocess) and the Claude-backed failure classifier. Stub both to safe
    no-op defaults so tests exercise our own control flow, not node/Claude. Tests
    that need a specific outcome override these locally after this fixture runs."""
    from app.services import failure_classifier, spec_service

    monkeypatch.setattr(spec_service, "playwright_list_ok", lambda *a, **k: True)
    monkeypatch.setattr(
        failure_classifier,
        "classify_failure",
        lambda *a, **k: {
            "failureClass": "test_defect",
            "suspectedProductDefect": False,
            "reason": "stub",
        },
    )
    yield


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

    from app.services.workspace_scope import scoped_specs_dir

    spec_path = scoped_specs_dir(run.owner_id) / run.code / "1428-TC-01.spec.ts"
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


def test_update_case_spec_persists_and_rewrites_file(client, db_session, monkeypatch):
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    run, case = _seed_run_and_case(db_session)

    # Seed a spec via regenerate, then edit it.
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200

    edited = "import { test } from '@playwright/test';\n\ntest('edited', async () => {});\n"
    resp = client.patch(f"/cases/{case.id}/spec", json={"code": edited})
    assert resp.status_code == 200
    body = resp.json()
    assert body["testCaseId"] == case.id
    assert body["code"] == edited

    from app.services.workspace_scope import scoped_specs_dir

    spec_path = scoped_specs_dir(run.owner_id) / run.code / "1428-TC-01.spec.ts"
    assert spec_path.exists()
    assert spec_path.read_text(encoding="utf-8") == edited

    from app.db import SessionLocal
    from app.models.testcase import AutomationSpec

    db = SessionLocal()
    try:
        row = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
        assert row is not None
        assert row.code == edited
        assert row.path == str(spec_path)
    finally:
        db.close()


def test_update_case_spec_missing_spec_returns_404(client, db_session):
    run, case = _seed_run_and_case(db_session)
    resp = client.patch(f"/cases/{case.id}/spec", json={"code": "x"})
    assert resp.status_code == 404


def test_generate_missing_run_returns_404(client, db_session):
    resp = client.post("/runs/9999/automation/generate")
    assert resp.status_code == 404


def _add_case(db_session, run, *, code, ticket="SUR-2001"):
    """Attach another approved, Playwright case to an existing run."""
    from app.models.testcase import TestCase

    case = TestCase(
        run_id=run.id,
        ticket_external_id=ticket,
        code=code,
        title="Second case",
        precondition="",
        steps=[{"a": "do", "e": "done"}],
        approval="approved",
        automation="Playwright",
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)
    return case


def _wait_for_specs(client, run_id, count):
    """Poll the run's spec list until it reaches ``count`` (background gen)."""
    for _ in range(60):
        specs = client.get(f"/runs/{run_id}/automation").json()
        if len(specs) >= count:
            return specs
        time.sleep(0.05)
    return client.get(f"/runs/{run_id}/automation").json()


def test_generate_is_incremental_and_preserves_edits(client, db_session, monkeypatch):
    """Re-generating after approving a new case leaves existing (edited) specs
    untouched and only generates the newly approved case."""
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    run, case_a = _seed_run_and_case(db_session)

    assert client.post(f"/runs/{run.id}/automation/generate").status_code == 200
    _wait_for_specs(client, run.id, 1)

    # Edit case A's spec — this is the work we must not clobber.
    edited = "import { test } from '@playwright/test';\n\ntest('hand edited', async () => {});\n"
    assert client.patch(f"/cases/{case_a.id}/spec", json={"code": edited}).status_code == 200

    # Approve a second case, then generate again (incremental by default).
    case_b = _add_case(db_session, run, code="TC-02")
    assert client.post(f"/runs/{run.id}/automation/generate").status_code == 200
    _wait_for_specs(client, run.id, 2)

    # Case A keeps the manual edit; case B was generated fresh.
    assert client.get(f"/cases/{case_a.id}/spec").json()["code"] == edited
    assert "test('Login works'" in client.get(f"/cases/{case_b.id}/spec").json()["code"]


def _seed_execution_result(db_session, run, case, *, status="fail"):
    """Attach an Execution + one ExecutionResult for a case (what heal updates)."""
    from app.models.execution import Execution, ExecutionResult

    execution = Execution(run_id=run.id, status="done", total=1, passed=0, failed=1)
    db_session.add(execution)
    db_session.flush()
    result = ExecutionResult(
        execution_id=execution.id,
        test_case_id=case.id,
        ticket_external_id=case.ticket_external_id,
        case_code=case.code,
        title=case.title,
        status=status,
        error_message="Timed out",
    )
    db_session.add(result)
    db_session.commit()
    return execution, result


def _wait_heal_done(client, case_id):
    for _ in range(100):
        if not client.get(f"/cases/{case_id}/spec/heal/status").json()["healing"]:
            return
        time.sleep(0.05)


def test_heal_missing_spec_returns_404(client, db_session):
    run, case = _seed_run_and_case(db_session)
    resp = client.post(f"/cases/{case.id}/spec/heal")
    assert resp.status_code == 404


def test_heal_rejected_while_run_executing(client, db_session, monkeypatch):
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200

    # The endpoint reads via the shared db_session, so set status on it directly.
    run.status = "executing"
    db_session.commit()

    assert client.post(f"/cases/{case.id}/spec/heal").status_code == 409


def test_heal_passes_first_run_marks_result_pass(client, db_session, monkeypatch):
    from app.services import claude_cli, playwright_runner

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    _seed_execution_result(db_session, run, case, status="fail")

    def fake_invoke(spec_dir_arg, workers, timeout_s, spec_file=""):
        report = {
            "suites": [
                {
                    "file": "1428-TC-01.spec.ts",
                    "specs": [
                        {
                            "title": "Login works",
                            "file": "1428-TC-01.spec.ts",
                            "tests": [{"results": [{"status": "passed", "duration": 42, "attachments": []}]}],
                        }
                    ],
                    "suites": [],
                }
            ]
        }
        (spec_dir_arg / "report.json").write_text(__import__("json").dumps(report), encoding="utf-8")
        return 0, "1 passed", ""

    # generate_fixed_spec_code must NOT be called when it passes on attempt 1.
    def boom_fix(*a, **k):
        raise AssertionError("should not regenerate when the first run passes")

    monkeypatch.setattr(playwright_runner, "_invoke_playwright", fake_invoke)
    monkeypatch.setattr(playwright_runner.spec_service, "generate_fixed_spec_code", boom_fix)

    assert client.post(f"/cases/{case.id}/spec/heal").json()["started"] is True
    _wait_heal_done(client, case.id)

    from app.db import SessionLocal
    from app.models.execution import ExecutionResult

    db = SessionLocal()
    try:
        result = (
            db.query(ExecutionResult)
            .filter(ExecutionResult.test_case_id == case.id)
            .order_by(ExecutionResult.id.desc())
            .first()
        )
        assert result.status == "pass"
        assert result.error_message == ""
    finally:
        db.close()


def test_heal_fixes_then_passes_updates_spec(client, db_session, monkeypatch):
    from app.services import claude_cli, playwright_runner

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    _seed_execution_result(db_session, run, case, status="fail")

    calls = {"invoke": 0, "fix": 0}

    def fake_invoke(spec_dir_arg, workers, timeout_s, spec_file=""):
        calls["invoke"] += 1
        status = "failed" if calls["invoke"] == 1 else "passed"
        entry_result = {"status": status, "duration": 10, "attachments": []}
        if status == "failed":
            entry_result["error"] = {"message": "selector not found"}
        report = {
            "suites": [
                {
                    "file": "1428-TC-01.spec.ts",
                    "specs": [
                        {
                            "title": "Login works",
                            "file": "1428-TC-01.spec.ts",
                            "tests": [{"results": [entry_result]}],
                        }
                    ],
                    "suites": [],
                }
            ]
        }
        (spec_dir_arg / "report.json").write_text(__import__("json").dumps(report), encoding="utf-8")
        return (1 if status == "failed" else 0), status, ""

    # A valid fix keeps at least as many assertions as before (anti-cheat gate):
    # this one adds a distinguishing comment while preserving the assertions.
    FIXED = (
        "import { test, expect } from '@playwright/test';\n\n"
        "test('Login works', async ({ page }) => {\n"
        "  // fixed\n"
        "  await page.goto('https://example.com/login');\n"
        "  await expect(page).toHaveTitle(/Login/);\n"
        "});\n"
    )

    def fake_fix(case_arg, current_code, error_message, run_output="", context=None, examples=None):
        calls["fix"] += 1
        assert "selector not found" in error_message
        return FIXED

    monkeypatch.setattr(playwright_runner, "_invoke_playwright", fake_invoke)
    monkeypatch.setattr(playwright_runner.spec_service, "generate_fixed_spec_code", fake_fix)

    assert client.post(f"/cases/{case.id}/spec/heal").json()["started"] is True
    _wait_heal_done(client, case.id)

    assert calls["fix"] == 1  # fixed once after the first failure
    assert calls["invoke"] == 2  # ran, failed, re-ran, passed

    # The healed code is persisted to the spec.
    assert client.get(f"/cases/{case.id}/spec").json()["code"] == FIXED

    from app.db import SessionLocal
    from app.models.execution import ExecutionResult

    db = SessionLocal()
    try:
        result = (
            db.query(ExecutionResult)
            .filter(ExecutionResult.test_case_id == case.id)
            .order_by(ExecutionResult.id.desc())
            .first()
        )
        assert result.status == "pass"
    finally:
        db.close()


def test_heal_report_captures_attempts_and_diff(client, db_session, monkeypatch):
    """After a fix-then-pass heal, GET /cases/{id}/spec/heal/report returns the
    per-attempt trail with the error and the unified diff of what changed."""
    from app.services import claude_cli, playwright_runner

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    _seed_execution_result(db_session, run, case, status="fail")

    calls = {"n": 0}

    def fake_invoke(spec_dir_arg, workers, timeout_s, spec_file=""):
        calls["n"] += 1
        status = "failed" if calls["n"] == 1 else "passed"
        res = {"status": status, "duration": 10, "attachments": []}
        if status == "failed":
            res["error"] = {"message": "locator resolved to 0 elements"}
        report = {"suites": [{"file": "1428-TC-01.spec.ts", "specs": [
            {"title": "Login works", "file": "1428-TC-01.spec.ts", "tests": [{"results": [res]}]}]}]}
        (spec_dir_arg / "report.json").write_text(__import__("json").dumps(report), encoding="utf-8")
        return (1 if status == "failed" else 0), status, ""

    # Keep >= the original assertion count (anti-cheat) while marking the change.
    FIXED = (
        "import { test, expect } from '@playwright/test';\n\n"
        "test('Login works', async ({ page }) => {\n"
        "  // healed\n"
        "  await page.goto('https://example.com/login');\n"
        "  await expect(page).toHaveTitle(/Login/);\n"
        "});\n"
    )
    monkeypatch.setattr(playwright_runner, "_invoke_playwright", fake_invoke)
    monkeypatch.setattr(playwright_runner.spec_service, "generate_fixed_spec_code",
                        lambda *a, **k: FIXED)

    assert client.post(f"/cases/{case.id}/spec/heal").json()["started"] is True
    _wait_heal_done(client, case.id)

    report = client.get(f"/cases/{case.id}/spec/heal/report").json()
    assert report["finalStatus"] == "pass"
    assert len(report["attempts"]) == 2
    first, second = report["attempts"]
    assert first["status"] == "fail"
    assert "locator resolved to 0 elements" in first["error"]
    assert first["fixed"] is True and "healed" in first["diff"]  # diff shows the change
    assert second["status"] == "pass"


def test_heal_report_empty_when_never_healed(client, db_session, monkeypatch):
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    assert client.get(f"/cases/{case.id}/spec/heal/report").json() == {}


def test_generate_force_regenerates_existing_specs(client, db_session, monkeypatch):
    """force=true overwrites existing specs, including manual edits."""
    from app.services import claude_cli

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)

    run, case_a = _seed_run_and_case(db_session)
    assert client.post(f"/runs/{run.id}/automation/generate").status_code == 200
    _wait_for_specs(client, run.id, 1)

    edited = "import { test } from '@playwright/test';\n\ntest('hand edited', async () => {});\n"
    assert client.patch(f"/cases/{case_a.id}/spec", json={"code": edited}).status_code == 200

    assert client.post(f"/runs/{run.id}/automation/generate?force=true").status_code == 200
    for _ in range(60):
        code = client.get(f"/cases/{case_a.id}/spec").json()["code"]
        if "hand edited" not in code:
            break
        time.sleep(0.05)
    assert "test('Login works'" in code
    assert "hand edited" not in code


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


def test_heal_rejects_assertion_weakening_fix(client, db_session, monkeypatch):
    """Anti-cheat: a regenerated 'fix' with fewer assertions than the current spec
    is rejected — the previous good spec is kept verbatim and the heal is marked
    failed (a weaker check is never a valid fix)."""
    from app.services import claude_cli, playwright_runner

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    original = client.get(f"/cases/{case.id}/spec").json()["code"]  # 3 assertions
    _seed_execution_result(db_session, run, case, status="fail")

    def fake_invoke(spec_dir_arg, workers, timeout_s, spec_file=""):
        report = {"suites": [{"file": "1428-TC-01.spec.ts", "specs": [
            {"title": "Login works", "file": "1428-TC-01.spec.ts", "tests": [
                {"results": [{"status": "failed", "duration": 5, "attachments": [],
                              "error": {"message": "boom"}}]}]}]}]}
        (spec_dir_arg / "report.json").write_text(__import__("json").dumps(report), encoding="utf-8")
        return 1, "failed", ""

    # The "fix" deletes every assertion — pure cheating; must be rejected.
    WEAK = "import { test } from '@playwright/test';\n\ntest('Login works', async () => {});\n"
    calls = {"fix": 0}

    def fake_fix(*a, **k):
        calls["fix"] += 1
        return WEAK

    monkeypatch.setattr(playwright_runner, "_invoke_playwright", fake_invoke)
    monkeypatch.setattr(playwright_runner.spec_service, "generate_fixed_spec_code", fake_fix)

    assert client.post(f"/cases/{case.id}/spec/heal").json()["started"] is True
    _wait_heal_done(client, case.id)

    # Previous good spec kept; the weakening fix never overwrote it.
    assert client.get(f"/cases/{case.id}/spec").json()["code"] == original
    assert calls["fix"] == 1

    from app.db import SessionLocal
    from app.models.execution import ExecutionResult
    from app.models.testcase import AutomationSpec

    db = SessionLocal()
    try:
        result = (
            db.query(ExecutionResult)
            .filter(ExecutionResult.test_case_id == case.id)
            .order_by(ExecutionResult.id.desc())
            .first()
        )
        assert result.status == "fail"
        spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
        assert spec.status == "failed"
    finally:
        db.close()


def test_heal_stops_on_product_defect_without_regenerating(client, db_session, monkeypatch):
    """A product-defect classification stops the heal loop before any regenerate:
    the spec is marked terminal ``product_defect`` and the fixer is never called."""
    from app.services import claude_cli, failure_classifier, playwright_runner

    monkeypatch.setattr(claude_cli, "run_prompt", lambda *a, **k: CANNED_SPEC)
    run, case = _seed_run_and_case(db_session)
    assert client.post(f"/cases/{case.id}/spec/regenerate").status_code == 200
    _seed_execution_result(db_session, run, case, status="fail")

    def fake_invoke(spec_dir_arg, workers, timeout_s, spec_file=""):
        report = {"suites": [{"file": "1428-TC-01.spec.ts", "specs": [
            {"title": "Login works", "file": "1428-TC-01.spec.ts", "tests": [
                {"results": [{"status": "failed", "duration": 5, "attachments": [],
                              "error": {"message": "expected $10 got $0"}}]}]}]}]}
        (spec_dir_arg / "report.json").write_text(__import__("json").dumps(report), encoding="utf-8")
        return 1, "failed", ""

    monkeypatch.setattr(
        failure_classifier, "classify_failure",
        lambda *a, **k: {"failureClass": "product_defect",
                         "suspectedProductDefect": True, "reason": "app returned $0"},
    )

    def boom_fix(*a, **k):
        raise AssertionError("product defect must NOT reach the fixer")

    monkeypatch.setattr(playwright_runner, "_invoke_playwright", fake_invoke)
    monkeypatch.setattr(playwright_runner.spec_service, "generate_fixed_spec_code", boom_fix)

    assert client.post(f"/cases/{case.id}/spec/heal").json()["started"] is True
    _wait_heal_done(client, case.id)

    from app.db import SessionLocal
    from app.models.execution import ExecutionResult
    from app.models.testcase import AutomationSpec

    db = SessionLocal()
    try:
        spec = db.query(AutomationSpec).filter(AutomationSpec.test_case_id == case.id).first()
        assert spec.status == "product_defect"
        result = (
            db.query(ExecutionResult)
            .filter(ExecutionResult.test_case_id == case.id)
            .order_by(ExecutionResult.id.desc())
            .first()
        )
        assert result.failure_class == "product_defect"
    finally:
        db.close()


def test_generation_gate_blocked_vs_rejected(db_session, monkeypatch):
    """The placeholder gate at generation time: the SAME placeholder is ``blocked``
    when the KB has no grounding (missing input) but ``rejected`` when the KB does
    provide routes/selectors the model should have used."""
    from app.routers import automation
    from app.models.run import Run
    from app.services import spec_service

    placeholder_spec = (
        "import { test, expect } from '@playwright/test';\n\n"
        "test('Login works', async ({ page }) => {\n"
        "  await page.goto('/login'); // TODO real route\n"
        "  await expect(page).toHaveTitle(/Login/);\n"
        "});\n"
    )
    monkeypatch.setattr(spec_service, "generate_spec_code", lambda *a, **k: placeholder_spec)

    # No KB grounding -> blocked (missing input); no runnable file written.
    monkeypatch.setattr(spec_service, "build_case_context", lambda *a, **k: {})
    run, case = _seed_run_and_case(db_session)
    spec = automation._generate_one(db_session, db_session.get(Run, run.id), case)
    db_session.commit()
    assert spec.status == "blocked"
    assert spec.block_reason
    from app.services.workspace_scope import scoped_specs_dir

    assert not (scoped_specs_dir(run.owner_id) / run.code / "1428-TC-01.spec.ts").exists()

    # KB has grounding for the very route/selectors -> the placeholder is a rejection.
    grounded = {"routes": [{"path": "/login"}], "selectors": ["#user"], "baseUrl": "https://x"}
    monkeypatch.setattr(spec_service, "build_case_context", lambda *a, **k: grounded)
    run2, case2 = _seed_run_and_case(db_session)
    spec2 = automation._generate_one(db_session, db_session.get(Run, run2.id), case2)
    db_session.commit()
    # No previous good spec to fall back on -> saved non-runnable, noting the rejection.
    assert spec2.status == "blocked"
    import json as _json

    assert _json.loads(spec2.gate_report)["outcome"] == "rejected"
