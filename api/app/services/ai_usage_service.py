"""Claude usage aggregation service.

Records one row per successful Claude CLI call (:func:`record`) and aggregates
those rows into the usage-stats contract consumed by ``GET /ai/stats``
(:func:`stats`). All figures are real per-call usage parsed from the CLI's JSON
envelope — nothing is fabricated.

Time windows:
  * ``requestsToday`` / ``avgLatencyMs`` — calls since local midnight today.
  * ``costMonth`` — cost summed over the current calendar month.
  * ``weekTokens`` — all-model total tokens for the current ISO week (Mon 00:00 → now).
  * ``breakdown`` — the *current* model's token sums for the current ISO week.
  * ``weekResetsAt`` — next Monday 00:00 (UTC, ISO) — the window boundary.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import db
from app.config import settings as app_settings
from app.logging import logger
from app.models.claude_usage import ClaudeUsage

# Static presentation map: model id -> (human label, context window).
MODEL_LABELS: dict[str, tuple[str, str]] = {
    "claude-opus-4-8": ("Claude Opus 4.8", "200K"),
    "claude-sonnet-5": ("Claude Sonnet 5", "200K"),
    "claude-haiku-4-5-20251001": ("Claude Haiku 4.5", "200K"),
}

# Recorded CLI ``action`` (skill id) -> (process key, display name). Groups the
# raw per-call usage rows into the coarse "process" buckets the per-run cost panel
# renders. Anything unmatched falls into an "other" bucket (see ``_process_for_action``).
_PROCESS_MAP: dict[str, tuple[str, str]] = {
    "requirement-analyst": ("analyze", "Analyze"),
    "test-case-generator": ("generate", "Generate cases"),
    "automation-generator": ("automation", "Automation"),
    "execution-analyzer": ("analysis", "Failure analysis"),
    "ticket-comment-generator": ("publish", "Publish"),
    "screenshot-annotator": ("evidence", "Evidence analysis"),
}


def _process_for_action(action: str) -> tuple[str, str]:
    """Map a recorded ``action`` to its ``(process key, display name)``.

    Known skill ids map to their fixed process; anything else falls into the
    ``other`` bucket with a titleized version of the action as its name.
    """
    raw = (action or "").strip()
    if raw in _PROCESS_MAP:
        return _PROCESS_MAP[raw]
    name = raw.replace("-", " ").replace("_", " ").strip().title() or "Other"
    return "other", name


def _current_model() -> str:
    """The operator-selected Claude model (mirrors ``claude_cli._resolve_model``)."""
    from app.services import settings_store

    return settings_store.load_settings().get("claudeModel") or app_settings.claude_model


def record(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read: int,
    cache_write: int,
    cost_usd: float,
    duration_ms: int,
    action: str,
    run_id: int | None = None,
) -> None:
    """Append one usage row for a completed Claude CLI call (best-effort).

    Opens its own short-lived session so it is independent of any request/thread
    session. Never raises into the caller — a logging failure must not break the
    Claude call it is observing.

    Args:
        model: The Claude model id the call ran against.
        input_tokens: Prompt input tokens.
        output_tokens: Generated output tokens.
        cache_read: Prompt-cache read tokens (``cache_read_input_tokens``).
        cache_write: Prompt-cache write tokens (``cache_creation_input_tokens``).
        cost_usd: Total call cost in USD (``total_cost_usd``).
        duration_ms: Wall-clock duration of the call in milliseconds.
        action: Human label for the call (skill / label / "Claude CLI").
        run_id: The run this call belongs to. When ``None`` (the common case for
            CLI callers) it is resolved from the ambient run context set by the
            run-scoped worker thread, so per-run spend can be attributed later.
    """
    if run_id is None:
        from app.services import run_context

        run_id = run_context.get_run()
    try:
        session = db.SessionLocal()
        try:
            session.add(
                ClaudeUsage(
                    run_id=run_id,
                    model=model or "",
                    input_tokens=int(input_tokens or 0),
                    output_tokens=int(output_tokens or 0),
                    cache_read_tokens=int(cache_read or 0),
                    cache_write_tokens=int(cache_write or 0),
                    cost_usd=float(cost_usd or 0.0),
                    duration_ms=int(duration_ms or 0),
                    action=action or "",
                )
            )
            session.commit()
        finally:
            session.close()
    except Exception as exc:  # noqa: BLE001 - usage logging must never break a call
        logger.warning("Claude usage record failed: {}", exc)


def stats() -> dict[str, Any]:
    """Aggregate recorded usage into the ``GET /ai/stats`` contract dict."""
    from app.services import claude_cli, settings_store

    model = _current_model()
    label, ctx_window = MODEL_LABELS.get(model, (model, "—"))

    now_local = datetime.now().astimezone()
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    week_start = today_start - timedelta(days=today_start.weekday())

    # Next Monday 00:00 UTC (the ISO-week reset boundary).
    now_utc = datetime.now(timezone.utc)
    today_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    days_ahead = 7 - now_utc.weekday()  # Mon=0 -> 7 (always the *next* Monday)
    next_monday_utc = today_utc + timedelta(days=days_ahead)
    week_resets_at = next_monday_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    session = db.SessionLocal()
    try:
        # Today: request count + average latency.
        requests_today, avg_latency = session.query(
            func.count(ClaudeUsage.id), func.avg(ClaudeUsage.duration_ms)
        ).filter(ClaudeUsage.ts >= today_start).one()

        # This calendar month: total cost.
        cost_month = session.query(func.sum(ClaudeUsage.cost_usd)).filter(
            ClaudeUsage.ts >= month_start
        ).scalar()

        # This ISO week, all models: total tokens (input+output+cacheRead+cacheWrite).
        week_totals = session.query(
            func.sum(ClaudeUsage.input_tokens),
            func.sum(ClaudeUsage.output_tokens),
            func.sum(ClaudeUsage.cache_read_tokens),
            func.sum(ClaudeUsage.cache_write_tokens),
        ).filter(ClaudeUsage.ts >= week_start).one()

        # This ISO week, current model only: per-kind breakdown.
        model_totals = session.query(
            func.sum(ClaudeUsage.input_tokens),
            func.sum(ClaudeUsage.output_tokens),
            func.sum(ClaudeUsage.cache_read_tokens),
            func.sum(ClaudeUsage.cache_write_tokens),
        ).filter(ClaudeUsage.ts >= week_start, ClaudeUsage.model == model).one()
    finally:
        session.close()

    week_tokens = sum(int(v or 0) for v in week_totals)
    bk_input, bk_output, bk_cache_read, bk_cache_write = (int(v or 0) for v in model_totals)

    week_budget = int(settings_store.load_settings().get("weeklyTokenBudget") or 0)

    return {
        "model": model,
        "modelLabel": label,
        "operational": claude_cli.is_available(),
        "ctxWindow": ctx_window,
        "requestsToday": int(requests_today or 0),
        "avgLatencyMs": int(round(avg_latency or 0)),
        "costMonth": round(float(cost_month or 0.0), 2),
        "weekTokens": week_tokens,
        "weekBudget": week_budget,
        "weekResetsAt": week_resets_at,
        "breakdown": {
            "input": bk_input,
            "output": bk_output,
            "cacheRead": bk_cache_read,
            "cacheWrite": bk_cache_write,
        },
    }


def run_breakdown(session: Session, run_id: int) -> dict[str, Any]:
    """Aggregate one run's recorded Claude usage into the per-run cost contract.

    Sums every :class:`ClaudeUsage` row stamped with ``run_id``, grouped into
    coarse process buckets (see :data:`_PROCESS_MAP`). Per-process ``tokens`` is
    the all-kinds total (input+output+cacheRead+cacheWrite); totals sum across the
    processes. ``modelLabel`` is the most-used model's human label. Returns the
    empty-usage shape (``processes: []``) when the run has no recorded calls.

    Args:
        session: An open SQLAlchemy session bound to the app database.
        run_id: The run whose usage rows to aggregate.

    Returns:
        The ``GET /runs/{run_id}/ai-usage`` contract dict.
    """
    rows = session.query(ClaudeUsage).filter(ClaudeUsage.run_id == run_id).all()
    if not rows:
        return {
            "runId": run_id,
            "modelLabel": "",
            "totalCostUsd": 0.0,
            "totalTokens": 0,
            "processes": [],
        }

    model_counts: dict[str, int] = {}
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        model_counts[row.model or ""] = model_counts.get(row.model or "", 0) + 1
        key, name = _process_for_action(row.action)
        group = groups.get(key)
        if group is None:
            group = groups[key] = {
                "key": key,
                "name": name,
                "action": (row.action or "").strip() or key,
                "input": 0,
                "output": 0,
                "tokens": 0,
                "costUsd": 0.0,
                "calls": 0,
            }
        row_tokens = (
            int(row.input_tokens or 0)
            + int(row.output_tokens or 0)
            + int(row.cache_read_tokens or 0)
            + int(row.cache_write_tokens or 0)
        )
        group["input"] += int(row.input_tokens or 0)
        group["output"] += int(row.output_tokens or 0)
        group["tokens"] += row_tokens
        group["costUsd"] += float(row.cost_usd or 0.0)
        group["calls"] += 1

    top_model = max(model_counts, key=lambda m: model_counts[m])
    model_label = MODEL_LABELS.get(top_model, (top_model, ""))[0] if top_model else ""

    processes = []
    for group in groups.values():
        calls = group["calls"]
        processes.append(
            {
                "key": group["key"],
                "name": group["name"],
                "meta": f"{group['action']} · {calls} call{'s' if calls != 1 else ''}",
                "input": group["input"],
                "output": group["output"],
                "tokens": group["tokens"],
                "costUsd": round(group["costUsd"], 2),
            }
        )
    processes.sort(key=lambda p: p["costUsd"], reverse=True)

    return {
        "runId": run_id,
        "modelLabel": model_label,
        "totalCostUsd": round(sum(p["costUsd"] for p in processes), 2),
        "totalTokens": sum(p["tokens"] for p in processes),
        "processes": processes,
    }
