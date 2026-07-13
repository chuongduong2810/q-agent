"""Tests for the AI chat-edit spec worker (issue #270).

Exercises the background worker `_run_spec_chat` directly (Claude mocked) against
the isolated `db_session` fixture — asserting it persists the edited code, re-gates
it, and publishes `automation.chat.reply` with the pre-edit `prevCode`. Mirrors the
direct-worker style of `test_heal_agent.py` rather than the flaky TestClient path.
"""

from __future__ import annotations

import app.routers.automation as automation
from app.services import spec_service


def _seed(db_session, code: str):
    from app.models.run import Run
    from app.models.testcase import AutomationSpec, TestCase

    run = Run(code="RUN-1", name="Chat run", status="automation", workers=1)
    db_session.add(run)
    db_session.flush()
    case = TestCase(
        run_id=run.id, ticket_external_id="SUR-1428", code="TC-01",
        title="Login works", approval="approved", automation="Playwright",
    )
    db_session.add(case)
    db_session.flush()
    spec = AutomationSpec(test_case_id=case.id, filename="1428-TC-01.spec.ts", code=code, status="draft")
    db_session.add(spec)
    db_session.commit()
    return run, case, spec


_EDITED = (
    "import { test, expect } from '@playwright/test';\n"
    "test('Login works', async ({ page }) => {\n"
    "  await page.goto('/login');\n"
    "  await expect(page.getByTestId('go')).toBeVisible();\n"
    "});\n"
)


def test_run_spec_chat_persists_edit_and_publishes_reply(db_session, monkeypatch):
    run, case, spec = _seed(db_session, code="// old spec\n")
    published: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(automation.hub, "publish", lambda ch, ev, p: published.append((ch, ev, p)))
    monkeypatch.setattr(
        spec_service, "generate_chat_edit", lambda *a, **k: ("Switched to data-testid selectors.", _EDITED)
    )
    # Ground the gate so the edit passes; skip the real Playwright --list check + file write.
    monkeypatch.setattr(
        spec_service, "build_case_context",
        lambda *a, **k: {"projectKey": "P", "routes": [{"path": "/login"}],
                         "selectors": [{"selector": "go"}], "baseUrl": "http://x"},
    )
    monkeypatch.setattr(spec_service, "playwright_list_ok", lambda *a, **k: True)
    monkeypatch.setattr(spec_service, "write_spec_file", lambda *a, **k: "spec.ts")

    automation._run_spec_chat(run.id, case.id, "use data-testid selectors", "msg-1")

    db_session.refresh(spec)
    assert spec.code == _EDITED
    assert spec.status == "draft"
    replies = [p for (_ch, ev, p) in published if ev == "automation.chat.reply"]
    assert len(replies) == 1
    r = replies[0]
    assert r["caseId"] == case.id and r["messageId"] == "msg-1"
    assert r["text"] == "Switched to data-testid selectors."
    assert r["prevCode"] == "// old spec\n"  # pre-edit code for Undo
    assert r["spec"]["code"] == _EDITED


def test_run_spec_chat_publishes_error_on_claude_failure(db_session, monkeypatch):
    run, case, _spec = _seed(db_session, code="// old\n")
    published: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(automation.hub, "publish", lambda ch, ev, p: published.append((ch, ev, p)))

    def boom(*a, **k):
        raise spec_service.claude_cli.ClaudeError("Claude down")

    monkeypatch.setattr(spec_service, "generate_chat_edit", boom)

    automation._run_spec_chat(run.id, case.id, "do a thing", "msg-2")

    errors = [p for (_ch, ev, p) in published if ev == "automation.chat.error"]
    assert len(errors) == 1
    assert errors[0]["messageId"] == "msg-2" and "Claude down" in errors[0]["error"]
