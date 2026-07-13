"""Tests for agent-executed self-heal server assist (issue #260).

Exercises `heal_service.plan_fix` (the classify → fix → gate decision the agent
calls per failed attempt) and `finalize_agent_heal` (persist + KB feedback),
with Claude + project-context resolution mocked. The DB comes from the shared
`db_session` fixture (isolated temp SQLite via Alembic — also proves the new
`executions.heal_case_id` migration applies).
"""

from __future__ import annotations

import json

import pytest
from app.services import heal_service


def _seed(db_session, current_code: str = ""):
    from app.models.run import Run
    from app.models.testcase import AutomationSpec, TestCase

    run = Run(code="RUN-1", name="Heal run", status="automation", workers=1)
    db_session.add(run)
    db_session.flush()
    case = TestCase(
        run_id=run.id, ticket_external_id="SUR-1428", code="TC-01",
        title="Login works", approval="approved", automation="Playwright",
    )
    db_session.add(case)
    db_session.flush()
    spec = AutomationSpec(
        test_case_id=case.id, filename="1428-TC-01.spec.ts",
        code=current_code or "x", status="failed",
    )
    db_session.add(spec)
    db_session.commit()
    return run, case, spec


@pytest.fixture
def grounding(monkeypatch):
    """Mock the DB/Claude-backed grounding so plan_fix's decision logic is testable."""
    monkeypatch.setattr(
        heal_service.spec_service, "build_case_context",
        lambda *a, **k: {
            "projectKey": "P", "baseUrl": "http://app.test",
            "routes": [{"path": "/login"}],
            "selectors": [{"screen": "Login", "element": "go", "selector": "#go"}],
        },
    )
    monkeypatch.setattr(heal_service.spec_examples, "select_examples", lambda *a, **k: [])
    monkeypatch.setattr(heal_service, "_resolve_project_for_run", lambda *a, **k: ("P", "", False, ""))


_GOOD_FIX = (
    "import { test, expect } from '@playwright/test';\n"
    "test('Login works', async ({ page }) => {\n"
    "  await page.goto('http://app.test/login');\n"
    "  await expect(page.locator('#go')).toBeVisible();\n"
    "});\n"
)


def test_plan_fix_returns_fixed_on_clean_gate(db_session, monkeypatch, grounding):
    run, case, _spec = _seed(db_session, current_code="await expect(page.locator('#go')).toBeVisible();")
    monkeypatch.setattr(
        heal_service.failure_classifier, "classify_failure",
        lambda *a, **k: {"failureClass": "test_defect", "suspectedProductDefect": False, "reason": "r"},
    )
    monkeypatch.setattr(heal_service.spec_service, "generate_fixed_spec_code", lambda *a, **k: _GOOD_FIX)

    out = heal_service.plan_fix(db_session, case, run, "old code", "err", "out", None)
    assert out["action"] == "fixed"
    assert "expect(" in out["code"]
    assert out["diff"]  # unified diff present


def test_plan_fix_product_defect_short_circuits(db_session, monkeypatch, grounding):
    run, case, _spec = _seed(db_session)
    monkeypatch.setattr(
        heal_service.failure_classifier, "classify_failure",
        lambda *a, **k: {"failureClass": "product_defect", "suspectedProductDefect": True, "reason": "app bug"},
    )
    # Claude fix must NOT be called for a product defect.
    monkeypatch.setattr(
        heal_service.spec_service, "generate_fixed_spec_code",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("fixer must not run")),
    )
    out = heal_service.plan_fix(db_session, case, run, "code", "err", "out", None)
    assert out["action"] == "product_defect"
    assert out["failureClass"] == "product_defect"


def test_plan_fix_rejects_assertion_weakening(db_session, monkeypatch, grounding):
    run, case, _spec = _seed(db_session)
    monkeypatch.setattr(
        heal_service.failure_classifier, "classify_failure",
        lambda *a, **k: {"failureClass": "test_defect", "suspectedProductDefect": False, "reason": "r"},
    )
    # current code has two assertions; the "fix" has one -> anti-cheat rejects it.
    current = (
        "await expect(page.locator('#a')).toBeVisible();\n"
        "await expect(page.locator('#b')).toBeVisible();\n"
    )
    monkeypatch.setattr(
        heal_service.spec_service, "generate_fixed_spec_code",
        lambda *a, **k: "await expect(page.locator('#a')).toBeVisible();\n",
    )
    out = heal_service.plan_fix(db_session, case, run, current, "err", "out", None)
    assert out["action"] == "rejected"
    assert "assert" in out["reason"].lower()


def test_finalize_pass_sets_status_and_feeds_kb(db_session, monkeypatch):
    run, case, spec = _seed(db_session)
    monkeypatch.setattr(heal_service.spec_service, "write_spec_file", lambda *a, **k: "spec.ts")
    monkeypatch.setattr(heal_service, "_resolve_project_for_run", lambda *a, **k: ("P", "", False, ""))
    calls = {"merge": [], "swap": []}
    monkeypatch.setattr(
        heal_service.playwright_runner, "_merge_discovered_dom_to_kb",
        lambda *a, **k: calls["merge"].append(a),
    )
    monkeypatch.setattr(
        heal_service.playwright_runner, "_propose_healed_selector_to_kb",
        lambda *a, **k: calls["swap"].append(a),
    )

    heal_service.finalize_agent_heal(
        db_session, case, run,
        {
            "finalStatus": "pass", "finalCode": _GOOD_FIX,
            "domDistilled": {"path": "/login", "elements": []},
            "lastFixBefore": "await page.locator('#old').click();",
            "lastFixAfter": "await page.locator('#go').click();",
            "attempts": [{"attempt": 1, "status": "pass"}],
        },
    )
    db_session.refresh(spec)
    assert spec.status == "passed"
    assert json.loads(spec.heal_report)["finalStatus"] == "pass"
    assert calls["merge"] and calls["swap"]  # both KB feedback paths fired on a pass


def test_heal_status_reports_queued_agent_heal(db_session):
    """The heal-status endpoint flags a queued/running agent heal so the button
    shows 'Healing…' immediately (not only once heal.progress streams)."""
    from app.models.execution import Execution
    from app.routers.automation import heal_case_spec_status

    run, case, _spec = _seed(db_session)
    assert heal_case_spec_status(case.id, db=db_session, user=None)["healing"] is False

    ex = Execution(run_id=run.id, status="queued", target="local-agent", heal_case_id=case.id, total=1)
    db_session.add(ex)
    db_session.commit()
    assert heal_case_spec_status(case.id, db=db_session, user=None)["healing"] is True


def test_finalize_blocked_sets_block_reason(db_session, monkeypatch):
    run, case, spec = _seed(db_session)
    monkeypatch.setattr(heal_service.spec_service, "write_spec_file", lambda *a, **k: "spec.ts")
    monkeypatch.setattr(heal_service, "_resolve_project_for_run", lambda *a, **k: ("P", "", False, ""))

    heal_service.finalize_agent_heal(
        db_session, case, run,
        {"finalStatus": "blocked", "finalCode": "x", "blockReason": "No KB grounding", "attempts": []},
    )
    db_session.refresh(spec)
    assert spec.status == "blocked"
    assert spec.block_reason == "No KB grounding"
