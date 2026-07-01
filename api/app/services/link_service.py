"""Create approved test cases in the provider and link them to their work items.

Runs in a background thread (provider writes can be slow — several per ticket),
publishing ``sync.progress`` / ``sync.done`` over the run's WebSocket topic, and
persists LinkedTestCase rows shown on the Ticket detail page.
"""

from __future__ import annotations

import threading
from typing import Any

from app import crypto
from app import db as db_module
from app.logging import logger
from app.models.linked import LinkedTestCase
from app.models.provider import Provider
from app.models.run import Run
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError
from app.ws import hub

# Runs currently executing a create+link pass (drives the 'running' status).
_running: set[int] = set()


def is_running(run_id: int) -> bool:
    return run_id in _running


def link_status(db, run_id: int) -> dict[str, Any]:
    """Current create+link status + per-ticket results for a run."""
    rows = db.query(LinkedTestCase).filter(LinkedTestCase.run_id == run_id).all()
    by_ticket: dict[str, list[LinkedTestCase]] = {}
    for r in rows:
        by_ticket.setdefault(r.ticket_external_id, []).append(r)
    results = [
        {
            "ticketExternalId": tid,
            "providerKind": items[0].provider_kind,
            "count": len(items),
            "created": True,
            "linked": any(i.linked for i in items),
            "error": "",
        }
        for tid, items in by_ticket.items()
    ]
    status = "running" if run_id in _running else ("done" if rows else "idle")
    return {"status": status, "results": results}


def start_create_link(run_id: int, link: bool, ticket_ids: list[str] | None) -> None:
    """Kick off the background create+link pass (no-op if already running)."""
    if run_id in _running:
        return
    _running.add(run_id)
    threading.Thread(
        target=_worker, args=(run_id, link, ticket_ids or []), daemon=True
    ).start()


def _adapter_for(db, kind: str, cache: dict[str, Any]) -> Any:
    if kind in cache:
        return cache[kind]
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        raise ProviderError(f"Provider '{kind}' is not configured")
    secrets = {k: crypto.decrypt(v) for k, v in (provider.secrets or {}).items()}
    adapter = get_adapter(kind, provider.config or {}, secrets)
    cache[kind] = adapter
    return adapter


def _worker(run_id: int, link: bool, ticket_ids: list[str]) -> None:
    db = db_module.SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run is None:
            return
        run.status = "sync"
        db.commit()
        hub.publish(str(run_id), "run.status", {"status": "sync"})

        query = db.query(TestCase).filter(
            TestCase.run_id == run_id, TestCase.approval == "approved"
        )
        if ticket_ids:
            query = query.filter(TestCase.ticket_external_id.in_(ticket_ids))
        cases = query.order_by(TestCase.ticket_external_id, TestCase.code).all()

        grouped: dict[str, list[TestCase]] = {}
        for c in cases:
            grouped.setdefault(c.ticket_external_id, []).append(c)

        adapters: dict[str, Any] = {}
        for tid, group in grouped.items():
            ticket = db.query(Ticket).filter(Ticket.external_id == tid).first()
            kind = ticket.provider_kind if ticket else "ado"
            created_any = False
            linked_any = False
            error = ""
            try:
                adapter = _adapter_for(db, kind, adapters)
                for case in group:
                    res = adapter.create_test_case(
                        tid,
                        title=case.title,
                        precondition=case.precondition,
                        steps=case.steps or [],
                        priority=case.priority,
                        link=link,
                    )
                    _upsert_link(db, run_id, case, kind, res)
                    created_any = True
                    linked_any = linked_any or bool(res.get("linked"))
                db.commit()
            except Exception as exc:  # noqa: BLE001 - surface per-ticket, don't kill the pass
                db.rollback()
                error = str(exc)[:200]
                logger.error("Create&link failed for {}: {}", tid, error)
            hub.publish(
                str(run_id),
                "sync.progress",
                {"ticket": tid, "created": created_any, "linked": linked_any, "error": error},
            )
        hub.publish(str(run_id), "sync.done", {})
    finally:
        _running.discard(run_id)
        db.close()


def _upsert_link(db, run_id: int, case: TestCase, kind: str, res: dict[str, Any]) -> None:
    row = (
        db.query(LinkedTestCase)
        .filter(LinkedTestCase.run_id == run_id, LinkedTestCase.test_case_id == case.id)
        .first()
    )
    if row is None:
        row = LinkedTestCase(run_id=run_id, test_case_id=case.id)
        db.add(row)
    row.ticket_external_id = case.ticket_external_id
    row.provider_kind = kind
    row.external_id = str(res.get("external_id", ""))
    row.title = case.title
    row.status = res.get("status", "Design")
    row.url = res.get("url", "")
    row.linked = bool(res.get("linked"))
