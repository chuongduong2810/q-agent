"""Tests for the AI analysis + test-case generation pipeline (app.services.ai_service)."""

from __future__ import annotations

from app.models.run import Run, RunTicket
from app.models.testcase import TestCase
from app.services import ai_service
from app.services.claude_cli import ClaudeError

CANNED_ANALYSIS = {
    "businessRules": ["Reset link must be single-use"],
    "functionalRequirements": ["Send reset email on request"],
    "validationRules": ["Email must be a valid format"],
    "risks": ["Link reuse after password change"],
    "edgeCases": ["Expired link clicked"],
    "missingInformation": ["What happens after 3 failed resets?"],
    "suggestedScope": "Cover reset request, link expiry, and reset completion.",
}

CANNED_CASES = [
    {
        "title": "Request reset link with valid email",
        "precondition": "User has a registered account",
        "steps": [{"a": "Submit valid email", "e": "Reset email is sent"}],
        "priority": "High",
        "testType": "Functional",
        "automation": "Playwright",
        "platform": "Web",
    },
    {
        "title": "Reset link expires after 30 minutes",
        "precondition": "A reset link was requested 31 minutes ago",
        "steps": [{"a": "Click expired link", "e": "Error shown, link rejected"}],
        "priority": "Medium",
        "testType": "Negative",
        "automation": "Playwright",
        "platform": "Web",
    },
]

# The second-stage reviewer (#173) audits the happy-path set and returns the
# deferred edge/negative coverage to append.
CANNED_REVIEW = {
    "verdict": "approve-with-changes",
    "coverageGaps": ["No test for reset request against an unregistered email"],
    "additionalCases": [
        {
            "title": "Reset request for unregistered email shows a neutral message",
            "precondition": "Email is not registered",
            "steps": [{"a": "Submit an unknown email", "e": "Neutral confirmation; no account leak"}],
            "priority": "Medium",
            "testType": "Negative",
            "automation": "Playwright",
            "platform": "Web",
        }
    ],
}
# A no-op review (used where the test asserts on the generation cap only).
CANNED_REVIEW_EMPTY = {"verdict": "approve", "coverageGaps": [], "additionalCases": []}


def _make_run(db_session, ticket_external_id: str) -> Run:
    run = Run(code="RUN-200", name="Test run", status="processing")
    db_session.add(run)
    db_session.flush()
    db_session.add(RunTicket(run_id=run.id, ticket_external_id=ticket_external_id, position=0))
    db_session.commit()
    db_session.refresh(run)
    return run


def test_pipeline_creates_analysis_and_cases(db_session, seed_ticket, monkeypatch):
    run = _make_run(db_session, seed_ticket.external_id)

    responses = iter([CANNED_ANALYSIS, CANNED_CASES, CANNED_REVIEW])
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: next(responses))

    ai_service.run_generation_pipeline(run.id, blocking=True)

    db_session.refresh(run)
    assert run.status == "review"

    run_ticket = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert run_ticket.gen_status == "done"
    assert run_ticket.analysis["suggestedScope"].startswith("Cover reset")
    # Reviewer verdict + coverage gaps recorded alongside the analysis.
    assert run_ticket.analysis["review"]["verdict"] == "approve-with-changes"

    cases = db_session.query(TestCase).filter(TestCase.run_id == run.id).order_by(TestCase.code).all()
    assert len(cases) == 3  # 2 happy-path + 1 reviewer-added
    assert [c.code for c in cases] == ["TC-01", "TC-02", "TC-03"]
    # Happy-path cases are source "ai"; the reviewer's addition is "ai-review".
    assert [c.source for c in cases] == ["ai", "ai", "ai-review"]
    assert all(c.approval == "pending" for c in cases)


def test_pipeline_caps_and_continues_numbering(db_session, seed_ticket, monkeypatch):
    """Respects maxCasesPerTicket and continues codes from existing provider cases."""
    from app.services import settings_store

    run = _make_run(db_session, seed_ticket.external_id)
    monkeypatch.setattr(settings_store, "load_settings", lambda: {"maxCasesPerTicket": 2})
    # Existing provider test cases up to TC-05 -> new codes start at TC-06.
    monkeypatch.setattr(ai_service, "provider_case_offset", lambda db, ticket: 5)

    many = [dict(CANNED_CASES[0]) for _ in range(6)]  # Claude returns 6; cap is 2
    responses = iter([CANNED_ANALYSIS, many, CANNED_REVIEW_EMPTY])
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: next(responses))

    ai_service.run_generation_pipeline(run.id, blocking=True)

    cases = db_session.query(TestCase).filter(TestCase.run_id == run.id).order_by(TestCase.code).all()
    assert len(cases) == 2  # capped (reviewer added none here)
    assert [c.code for c in cases] == ["TC-06", "TC-07"]  # continued from offset


def test_pipeline_surfaces_claude_error(db_session, seed_ticket, monkeypatch):
    run = _make_run(db_session, seed_ticket.external_id)

    def _boom(*a, **k):
        raise ClaudeError("CLI not authenticated")

    monkeypatch.setattr(ai_service, "run_json", _boom)

    ai_service.run_generation_pipeline(run.id, blocking=True)

    run_ticket = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert run_ticket.gen_status == "error"
    assert "CLI not authenticated" in run_ticket.analysis_error

    # Run still finishes (moves to review) even though one ticket errored.
    db_session.refresh(run)
    assert run.status == "review"

    assert db_session.query(TestCase).filter(TestCase.run_id == run.id).count() == 0


def test_pipeline_missing_ticket_sets_error(db_session):
    run = _make_run(db_session, "SUR-9999")

    ai_service.run_generation_pipeline(run.id, blocking=True)

    run_ticket = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert run_ticket.gen_status == "error"
    assert "not found" in run_ticket.analysis_error


def test_regenerate_case_updates_fields_and_sets_edited(db_session, seed_ticket, monkeypatch):
    run = _make_run(db_session, seed_ticket.external_id)
    case = TestCase(
        run_id=run.id,
        ticket_external_id=seed_ticket.external_id,
        code="TC-01",
        title="Old title",
        precondition="Old precondition",
        steps=[{"a": "old action", "e": "old expected"}],
        priority="Low",
        test_type="Functional",
        automation="Playwright",
        platform="Web",
        source="ai",
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)

    improved = {
        "title": "Improved title",
        "precondition": "Improved precondition",
        "steps": [{"a": "new action", "e": "new expected"}],
        "priority": "High",
        "testType": "Functional",
        "automation": "Playwright",
        "platform": "Web",
    }
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: improved)

    updated = ai_service.regenerate_case(db_session, case)

    assert updated.code == "TC-01"  # code preserved
    assert updated.title == "Improved title"
    assert updated.priority == "High"
    assert updated.edited is True


def test_next_case_code_increments(db_session, seed_ticket):
    run = _make_run(db_session, seed_ticket.external_id)
    db_session.add(
        TestCase(
            run_id=run.id,
            ticket_external_id=seed_ticket.external_id,
            code="TC-01",
            title="First",
        )
    )
    db_session.commit()

    assert ai_service.next_case_code(db_session, run.id, seed_ticket.external_id) == "TC-02"
