"""Report aggregation — builds a Report row from a Run's latest Execution.

Pure-ish helpers over a SQLAlchemy session so both the router (request-scoped
session) and any backgrounded caller (own SessionLocal) can reuse the same
aggregation + Claude failure-analysis logic.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.execution import Execution, ExecutionResult
from app.models.report import Report
from app.services import claude_cli
from app.services.claude_cli import ClaudeError
from app.services.skills import EXECUTION_ANALYZER


def ticket_status(approved_count: int, passed: int, failed: int) -> str:
    """A ticket's execution verdict.

    "Passed" ONLY when every approved, automatable test case of the ticket has a
    passing result (i.e. all its scripts ran and passed). Any failure -> "Failed";
    otherwise (not all approved cases have passed yet) -> "Pending".
    """
    if failed > 0:
        return "Failed"
    if approved_count > 0 and passed >= approved_count:
        return "Passed"
    return "Pending"


def approved_case_counts(db: Session, run_id: int) -> dict[str, int]:
    """Per-ticket count of approved, automatable (non-Manual) test cases in a run —
    the set whose scripts must all pass for the ticket to count as passed."""
    from sqlalchemy import func

    from app.models.testcase import TestCase

    rows = (
        db.query(TestCase.ticket_external_id, func.count())
        .filter(
            TestCase.run_id == run_id,
            TestCase.approval == "approved",
            TestCase.automation != "Manual",
        )
        .group_by(TestCase.ticket_external_id)
        .all()
    )
    return {tid: count for tid, count in rows}


def _latest_execution(db: Session, run_id: int) -> Execution | None:
    stmt = (
        select(Execution)
        .where(Execution.run_id == run_id)
        .order_by(Execution.id.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def _case_diagnosis(result: ExecutionResult) -> str:
    """The auto-annotation diagnosis for a result's failure screenshot, if any."""
    try:
        for e in result.evidence:
            if e.kind == "screenshot" and (e.meta or {}).get("diagnosis"):
                return str((e.meta or {}).get("diagnosis", ""))
    except Exception:  # noqa: BLE001 - evidence is best-effort context
        pass
    return ""


def _per_ticket_summary(
    results: list[ExecutionResult], approved_counts: dict[str, int] | None = None
) -> list[dict]:
    """Aggregate execution results into a per-ticket summary WITH per-case detail.

    Each ticket entry carries its pass/fail counts, a ``cases`` list (one row per
    executed test case: code, title, status, error, diagnosis), an
    ``approvedCount`` (approved automatable cases for the ticket) and a ``status``
    — the ticket is "Passed" only when every approved case's script ran and passed.
    """
    approved_counts = approved_counts or {}
    by_ticket: dict[str, dict] = {}
    for r in results:
        entry = by_ticket.setdefault(
            r.ticket_external_id,
            {"ticketExternalId": r.ticket_external_id, "passed": 0, "failed": 0,
             "total": 0, "cases": []},
        )
        entry["total"] += 1
        if r.status == "pass":
            entry["passed"] += 1
        elif r.status == "fail":
            entry["failed"] += 1
        entry["cases"].append(
            {
                "caseCode": r.case_code,
                "title": r.title,
                "status": r.status,
                "error": r.error_message or "",
                "diagnosis": _case_diagnosis(r) if r.status == "fail" else "",
            }
        )
    for tid, entry in by_ticket.items():
        entry["approvedCount"] = approved_counts.get(tid, entry["total"])
        entry["status"] = ticket_status(entry["approvedCount"], entry["passed"], entry["failed"])
    return list(by_ticket.values())


def _ai_failure_analysis(failed: list[ExecutionResult]) -> str:
    """Ask Claude to summarize the failed cases into a short root-cause narrative.

    Returns an empty string if there are no failures. Raises ClaudeError upward
    if the CLI is unavailable/errors — callers decide whether to surface or
    degrade the field to an error note (no simulated fallback per ADR 0001).
    """
    if not failed:
        return ""

    lines = [
        f"- [{r.ticket_external_id} / {r.case_code}] {r.title}: {r.error_message or 'failed'}"
        for r in failed
    ]
    prompt = (
        "You are a QA lead analyzing failed automated test cases from a Playwright run. "
        "Given the failures below, write a concise (3-6 sentence) failure analysis: likely "
        "root cause(s), whether failures look related, and a suggested next step.\n\n"
        "Failures:\n" + "\n".join(lines)
    )
    return claude_cli.run_prompt(prompt, skill=EXECUTION_ANALYZER, label="Failure analysis").strip()


def build_report(db: Session, run_id: int) -> Report:
    """Aggregate the run's latest Execution into a persisted Report.

    Computes pass/fail/rate/duration and a per-ticket summary, calls Claude for
    an AI failure-analysis narrative over failed cases, and inserts a new Report
    row (reports are append-only history, not upserted).
    """
    execution = _latest_execution(db, run_id)
    results = list(execution.results) if execution else []

    passed = sum(1 for r in results if r.status == "pass")
    failed = sum(1 for r in results if r.status == "fail")
    total = passed + failed
    pass_rate = round((passed / total) * 100, 1) if total else 0.0
    duration_s = round(sum(r.duration_ms for r in results) / 1000) if results else 0
    overall_result = "passed" if failed == 0 and total > 0 else "failed" if total > 0 else "unknown"

    failed_results = [r for r in results if r.status == "fail"]
    try:
        ai_failure_analysis = _ai_failure_analysis(failed_results)
    except ClaudeError as exc:
        ai_failure_analysis = f"AI failure analysis unavailable: {exc}"

    report = Report(
        run_id=run_id,
        execution_id=execution.id if execution else None,
        overall_result=overall_result,
        pass_rate=pass_rate,
        passed=passed,
        failed=failed,
        duration_s=duration_s,
        env=execution.env if execution else "Staging",
        data={
            "ticketSummary": _per_ticket_summary(results, approved_case_counts(db, run_id)),
            "aiFailureAnalysis": ai_failure_analysis,
        },
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report
