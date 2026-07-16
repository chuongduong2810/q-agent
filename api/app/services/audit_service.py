"""Audit event feed for the Audit Log page.

Backed by a real append-only ``audit_logs`` table. Events are written by
:func:`record` at each meaningful action, and read back by :func:`list_events` /
:func:`stats`. For installs that predate this feature, :func:`backfill_from_history`
seeds the table once from existing rows (runs, executions, knowledge, …) so the
page shows real history immediately; new activity accrues going forward.

``record`` is best-effort: it writes on its own short-lived session and swallows
errors so auditing can never break the action being audited.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app import db as db_module
from app.db import utcnow
from app.logging import logger
from app.models.audit import AuditLog
from app.services import audit_context
from app.models.comment import TicketComment
from app.models.execution import Execution
from app.models.knowledge import ProjectKnowledge
from app.models.linked import LinkedTestCase
from app.models.provider import Provider
from app.models.report import Report
from app.models.run import Run
from app.models.testcase import AutomationSpec, TestCase

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def record(
    *,
    category: str,
    action: str,
    actor_type: str = "user",
    actor: str | None = None,
    target: str = "",
    status: str = "success",
    ip: str | None = None,
    meta: str = "",
    ts: datetime | None = None,
    run_code: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append one audit event. Best-effort — never raises.

    Args:
        category: One of app.models.audit.AUDIT_CATEGORIES (e.g. "run", "execution").
        action: Human-readable action, e.g. "Created run".
        actor_type: "user" | "ai" | "system"; drives the default actor/ip.
        actor: Override the display actor (defaults from actor_type).
        target: What the action acted on, e.g. "RUN-205 · Sprint 24".
        status: "success" | "warning" | "error".
        ip: Override the source ip (defaults from actor_type).
        meta: Extra detail line shown in the expanded row.
        ts: Override the timestamp (defaults to now; used by backfill).
        run_code: The run this event belongs to (e.g. "RUN-205"), powering the
            per-run activity timeline (#394). When omitted it is auto-resolved
            from the ambient run scope (:func:`run_context.get_run`) so
            background run workers (analyze/generate, execution, exploration,
            self-heal) attribute events without threading it through every call.
        detail: Optional structured payload shown in the expanded row (#396),
            e.g. an exploration's step trail + discovered routes/selectors.
    """
    default_actor, default_ip = _actor_fields(actor_type)
    # Prefer the authenticated request actor (ADR 0007, #79) over the legacy
    # "You" default when the caller didn't pass one explicitly.
    if actor is None and actor_type == "user":
        actor = audit_context.get_actor()
    if run_code is None:
        run_code = _ambient_run_code()
    try:
        db = db_module.SessionLocal()
        try:
            db.add(
                AuditLog(
                    ts=ts or utcnow(),
                    category=category,
                    action=action,
                    actor=actor or default_actor,
                    actor_type=actor_type,
                    target=target,
                    status=status,
                    ip=ip or default_ip,
                    meta=meta,
                    run_code=run_code,
                    detail=detail,
                )
            )
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - auditing must never break the caller
        logger.warning("audit record failed ({} / {}): {}", category, action, exc)


def _ambient_run_code() -> str | None:
    """Resolve the current ambient run's code from :mod:`run_context`, or None.

    Background run workers set ``run_context.set_run(run_id)`` at their top; this
    maps that id back to ``Run.code`` on a short-lived session so a recorded event
    is attributed to the run without the caller passing it. Best-effort — any
    failure (no scope, lookup error) yields ``None`` (an unscoped event)."""
    from app.services import run_context

    run_id = run_context.get_run()
    if not run_id:
        return None
    try:
        db = db_module.SessionLocal()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            return run.code if run is not None else None
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - never break the caller on attribution
        return None


def _aware(dt: datetime | None) -> datetime:
    """Coerce a possibly-naive datetime to aware UTC (naive is assumed UTC)."""
    if dt is None:
        return _EPOCH
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _actor_fields(actor_type: str) -> tuple[str, str]:
    """(actor, ip) defaults for an actor type."""
    if actor_type == "ai":
        return "Q-Agent", "internal"
    if actor_type == "system":
        return "System", "system"
    return "You", "local"


def derive_events(db: Session) -> list[dict[str, Any]]:
    """Build the full audit event list from existing rows, newest first."""
    raw: list[dict[str, Any]] = []

    def add(dt: datetime | None, category: str, actor_type: str, action: str,
            target: str, status: str = "success", meta: str = "") -> None:
        actor, ip = _actor_fields(actor_type)
        raw.append({
            "_dt": _aware(dt),
            "category": category,
            "actorType": actor_type,
            "actor": actor,
            "action": action,
            "target": target,
            "status": status,
            "meta": meta,
            "ip": ip,
        })

    runs_by_id: dict[int, Run] = {}
    try:
        for run in db.query(Run).all():
            runs_by_id[run.id] = run
            add(run.created_at, "run", "user", "Created run",
                f"{run.code} · {run.name}", meta=f"{run.framework} · {run.env} · {run.workers} workers")
    except Exception:  # noqa: BLE001 - best-effort source
        pass

    def run_code(run_id: int | None) -> str:
        run = runs_by_id.get(run_id) if run_id is not None else None
        return run.code if run is not None else (f"RUN-{run_id}" if run_id else "run")

    # Test-case generation — one coarse event per run (not per case).
    try:
        by_run: dict[int, list[TestCase]] = {}
        for tc in db.query(TestCase).all():
            by_run.setdefault(tc.run_id, []).append(tc)
        for rid, cases in by_run.items():
            latest = max((_aware(c.created_at) for c in cases), default=_EPOCH)
            add(latest, "ai", "ai", "Generated test cases",
                f"{run_code(rid)} · {len(cases)} cases",
                meta=f"{len(cases)} test cases across the run")
    except Exception:  # noqa: BLE001
        pass

    # Automation generation — one event per run.
    try:
        specs = db.query(AutomationSpec, TestCase).join(
            TestCase, AutomationSpec.test_case_id == TestCase.id
        ).all()
        by_run_spec: dict[int, list[datetime]] = {}
        for spec, tc in specs:
            by_run_spec.setdefault(tc.run_id, []).append(_aware(spec.created_at))
        for rid, dts in by_run_spec.items():
            add(max(dts, default=_EPOCH), "run", "ai", "Generated automation",
                f"{run_code(rid)} · {len(dts)} specs", meta=f"{len(dts)} Playwright specs")
    except Exception:  # noqa: BLE001
        pass

    try:
        for ex in db.query(Execution).all():
            status = "warning" if (ex.failed or 0) > 0 else "success"
            add(ex.finished_at or ex.started_at or ex.created_at, "execution", "ai",
                "Executed test run", f"{run_code(ex.run_id)} · {ex.total} cases",
                status=status, meta=f"{ex.passed} passed · {ex.failed} failed")
    except Exception:  # noqa: BLE001
        pass

    try:
        for kb in db.query(ProjectKnowledge).all():
            add(kb.last_indexed or kb.updated_at or kb.created_at, "knowledge", "ai",
                "Built project knowledge base", f"{kb.name} · {kb.version}",
                meta=f"{kb.confidence}% confidence")
    except Exception:  # noqa: BLE001
        pass

    try:
        for c in db.query(TicketComment).all():
            posted = (c.status or "") == "published"
            add(c.created_at, "comment", "ai", "Posted results comment",
                f"{c.ticket_external_id} · {c.provider_kind}",
                status="success" if posted else "warning",
                meta="Comment published" if posted else "Draft prepared")
    except Exception:  # noqa: BLE001
        pass

    # Linked test cases — one event per (run, ticket).
    try:
        groups: dict[tuple[Any, str], list[LinkedTestCase]] = {}
        for lc in db.query(LinkedTestCase).all():
            groups.setdefault((lc.run_id, lc.ticket_external_id), []).append(lc)
        for (rid, tid), items in groups.items():
            latest = max((_aware(i.created_at) for i in items), default=_EPOCH)
            add(latest, "sync", "ai", "Created & linked test cases",
                f"{tid} · {items[0].provider_kind}", meta=f"{len(items)} test cases linked")
    except Exception:  # noqa: BLE001
        pass

    try:
        for p in db.query(Provider).filter(Provider.connected.is_(True)).all():
            add(p.last_sync or p.updated_at or p.created_at, "integration", "user",
                "Connected provider", p.name, meta=f"Provider kind: {p.kind}")
    except Exception:  # noqa: BLE001
        pass

    try:
        for r in db.query(Report).all():
            failed = (r.failed or 0) > 0
            add(r.created_at, "execution", "ai", "Generated report",
                f"{run_code(r.run_id)} · {r.overall_result}",
                status="warning" if failed else "success",
                meta=f"{r.passed} passed · {r.failed} failed")
    except Exception:  # noqa: BLE001
        pass

    raw.sort(key=lambda e: e["_dt"], reverse=True)
    total = len(raw)
    events: list[dict[str, Any]] = []
    for i, e in enumerate(raw):
        events.append({
            "id": f"EVT-{total - i}",
            "ts": e["_dt"].isoformat(),
            "category": e["category"],
            "actor": e["actor"],
            "actorType": e["actorType"],
            "action": e["action"],
            "target": e["target"],
            "ip": e["ip"],
            "status": e["status"],
            "meta": e["meta"],
            "_dt": e["_dt"],
        })
    return events


def _row_out(row: AuditLog) -> dict[str, Any]:
    """Serialize an AuditLog row to the camelCase wire shape the page expects."""
    return {
        "id": f"EVT-{row.id}",
        "ts": _aware(row.ts).isoformat(),
        "category": row.category,
        "actor": row.actor,
        "actorType": row.actor_type,
        "action": row.action,
        "target": row.target,
        "ip": row.ip,
        "status": row.status,
        "meta": row.meta,
        "runCode": row.run_code or "",
        "detail": row.detail or None,
    }


def list_events(
    db: Session, category: str = "all", actor: str = "all", q: str = "", run: str = ""
) -> list[dict[str, Any]]:
    """Filtered audit events from the audit_logs table, newest first.

    ``run`` scopes to a single run's code (e.g. "RUN-205") for the per-run
    activity timeline (#394); empty means all runs.
    """
    query = db.query(AuditLog)
    if category and category != "all":
        query = query.filter(AuditLog.category == category)
    if actor and actor != "all":
        query = query.filter(AuditLog.actor_type == actor)
    if run:
        query = query.filter(AuditLog.run_code == run)
    rows = query.order_by(AuditLog.ts.desc(), AuditLog.id.desc()).all()

    ql = (q or "").strip().lower()
    out: list[dict[str, Any]] = []
    for row in rows:
        if ql:
            hay = f"{row.action} {row.target} {row.actor} EVT-{row.id}".lower()
            if ql not in hay:
                continue
        out.append(_row_out(row))
    return out


def stats(db: Session) -> dict[str, int]:
    """Aggregate counts across all recorded events."""
    rows = db.query(AuditLog).all()
    today = datetime.now(timezone.utc).date()
    return {
        "eventsToday": sum(1 for r in rows if _aware(r.ts).date() == today),
        "aiActions": sum(1 for r in rows if r.actor_type == "ai"),
        "userActions": sum(1 for r in rows if r.actor_type == "user"),
        "failures": sum(1 for r in rows if r.status in ("warning", "error")),
    }


def _marker_path():
    """Persistent 'history already back-filled' marker (survives table clears)."""
    from app.config import settings as app_settings

    return app_settings.workspace_dir / ".audit_backfilled"


def _mark_backfilled() -> None:
    try:
        path = _marker_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("1", encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def backfill_from_history(db: Session) -> int:
    """One-time seed of audit_logs from existing rows.

    Runs only once ever (guarded by a persistent marker), so it can't
    double-count actions that are also recorded live, and — importantly — it does
    NOT re-seed after the user clears the log. A no-op if the marker exists or the
    table already has rows. Returns the number of rows inserted.
    """
    try:
        if _marker_path().exists():
            return 0
        if db.query(AuditLog.id).first() is not None:
            _mark_backfilled()  # already populated (live records) — never backfill
            return 0
        events = derive_events(db)
        if not events:
            return 0  # nothing to seed yet; leave unmarked so a later run can seed
        for e in events:
            db.add(
                AuditLog(
                    ts=e["_dt"],
                    category=e["category"],
                    action=e["action"],
                    actor=e["actor"],
                    actor_type=e["actorType"],
                    target=e["target"],
                    status=e["status"],
                    ip=e["ip"],
                    meta=e["meta"],
                )
            )
        db.commit()
        _mark_backfilled()
        return len(events)
    except Exception as exc:  # noqa: BLE001 - backfill must never break startup
        db.rollback()
        logger.warning("audit backfill failed: {}", exc)
        return 0


def clear_events(db: Session) -> int:
    """Delete every audit event. Also marks history as back-filled so a restart
    won't silently re-seed the table from existing rows. Returns rows deleted."""
    deleted = db.query(AuditLog).delete(synchronize_session=False)
    db.commit()
    _mark_backfilled()
    return int(deleted or 0)
