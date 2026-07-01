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


def _latest_execution(db: Session, run_id: int) -> Execution | None:
    stmt = (
        select(Execution)
        .where(Execution.run_id == run_id)
        .order_by(Execution.id.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def _per_ticket_summary(results: list[ExecutionResult]) -> list[dict]:
    """Aggregate execution results into a per-ticket pass/fail summary."""
    by_ticket: dict[str, dict] = {}
    for r in results:
        entry = by_ticket.setdefault(
            r.ticket_external_id,
            {"ticketExternalId": r.ticket_external_id, "passed": 0, "failed": 0, "total": 0},
        )
        entry["total"] += 1
        if r.status == "pass":
            entry["passed"] += 1
        elif r.status == "fail":
            entry["failed"] += 1
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
    return claude_cli.run_prompt(prompt).strip()


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
            "ticketSummary": _per_ticket_summary(results),
            "aiFailureAnalysis": ai_failure_analysis,
        },
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report
