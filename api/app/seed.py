"""Dev seed — loads the Surency demo dataset into the local SQLite DB.

This is a DEVELOPMENT convenience for demoing/visual-checking the UI without live
provider credentials. It is NOT a product fallback: nothing in the request path
depends on it. Run with:

    uv run python -m app.seed

It is idempotent-ish: it wipes the demo Run/tickets it owns and re-inserts them.
"""

from __future__ import annotations

from app.db import SessionLocal, init_db, utcnow
from app.models import (
    LinkedTestCase,
    ProviderConnection,
    ProjectConfig,
    ProjectKnowledge,
    Run,
    RunTicket,
    TestCase,
    Ticket,
)
from app.logging import logger, setup_logging
from app.services.sample_data import (
    CASE_BANK,
    TICKETS,
    build_project_config,
    build_project_knowledge,
)

HISTORICAL_RUNS = [
    dict(code="RUN-203", name="Auth smoke", status="done", tickets=["SUR-1428"]),
    dict(code="RUN-201", name="Full regression", status="done", tickets=["SUR-1428", "SUR-1402", "SUR-1390"]),
    dict(code="RUN-198", name="Claims portal", status="done", tickets=["SUR-1402"]),
]


def seed() -> None:
    setup_logging()
    init_db()
    db = SessionLocal()
    try:
        # Provider connections — two work-item categories (ADO + Jira) and one
        # repository category (GitHub). Multiple ADO connections demonstrate the
        # many-named-connections-per-kind model (ADR 0006).
        db.query(ProviderConnection).delete()
        ado_platform = ProviderConnection(
            kind="ado", name="Azure DevOps — Surency Platform", connected=True,
            config={"orgUrl": "https://dev.azure.com/surency", "project": "Surency Platform"},
            secrets={}, last_sync=utcnow())
        ado_labs = ProviderConnection(
            kind="ado", name="Azure DevOps — Surency Labs", connected=False,
            config={"orgUrl": "https://dev.azure.com/surency", "project": "Surency Labs"},
            secrets={})
        jira_conn = ProviderConnection(
            kind="jira", name="Jira Cloud", connected=False,
            config={"baseUrl": "https://surency.atlassian.net"}, secrets={})
        github_conn = ProviderConnection(
            kind="github", name="GitHub — surency-eng", connected=True,
            config={"org": "surency-eng", "repo": "surency-web"}, secrets={}, last_sync=utcnow())
        db.add_all([ado_platform, ado_labs, jira_conn, github_conn])
        db.flush()  # assign ids for ticket stamping + project binding

        # Tickets — stamp each with the work-item connection it came from.
        db.query(Ticket).delete()
        _work_item_conn = {"ado": ado_platform.id, "jira": jira_conn.id}
        for t in TICKETS:
            db.add(Ticket(connection_id=_work_item_conn.get(t["provider_kind"]), **t))

        # Runs (wipe + reseed)
        db.query(TestCase).delete()
        db.query(RunTicket).delete()
        db.query(Run).delete()

        # The active review-stage run: RUN-204
        run = Run(code="RUN-204", name="Sprint 24 — Broker regression", scope="selected",
                  scope_label="Selected tickets", framework="Playwright", browser="chromium",
                  env="Staging", workers=4, status="review")
        db.add(run)
        db.flush()
        for pos, tid in enumerate(["SUR-1428", "SUR-1402", "SUR-1390"]):
            db.add(RunTicket(run_id=run.id, ticket_external_id=tid, position=pos, gen_status="done"))
            for code, title, prio, ttype, auto, plat, pre, steps in CASE_BANK[tid]:
                # SUR-1428 non-manual cases pre-approved to demo Automation-ready state.
                approval = "approved" if (tid == "SUR-1428" and auto != "Manual") else "pending"
                db.add(TestCase(run_id=run.id, ticket_external_id=tid, code=code, title=title,
                                precondition=pre, steps=[{"a": a, "e": e} for a, e in steps],
                                priority=prio, test_type=ttype, automation=auto, platform=plat,
                                approval=approval, source="ai"))

        for hr in HISTORICAL_RUNS:
            r = Run(code=hr["code"], name=hr["name"], scope="selected", scope_label="Selected tickets",
                    framework="Playwright", browser="chromium", env="Staging", workers=4, status=hr["status"])
            db.add(r)
            db.flush()
            for pos, tid in enumerate(hr["tickets"]):
                db.add(RunTicket(run_id=r.id, ticket_external_id=tid, position=pos, gen_status="done"))

        # Linked test cases — a few already created + linked to SUR-1428 (demo).
        db.query(LinkedTestCase).delete()
        for i, (title, st) in enumerate(
            [
                ("Broker Management loads with two tabs", "Ready"),
                ("Agency row shows name, number, type, status", "Design"),
                ("Ellipsis on an Active agency offers Deactivate", "Design"),
            ]
        ):
            db.add(
                LinkedTestCase(
                    run_id=run.id,
                    ticket_external_id="SUR-1428",
                    provider_kind="ado",
                    external_id=str(4200 + i),
                    title=title,
                    status=st,
                    url="https://dev.azure.com/surency/_workitems/edit/" + str(4200 + i),
                    linked=True,
                )
            )

        # Project Knowledge — the primary repo pre-indexed (per-repo knowledge base)
        # so the detail view has content; a second repo is left un-indexed to demo
        # the mixed state.
        db.query(ProjectKnowledge).delete()
        db.add(build_project_knowledge())

        # Project Config — user-authored runtime settings for the demo project so
        # the Project Details → Settings tab is populated and generated specs get
        # a real base URL + credentials. Password is encrypted at rest.
        db.query(ProjectConfig).delete()
        db.add(build_project_config(ado_platform.id, github_conn.id))

        db.commit()
        logger.info("Seeded {} tickets, RUN-204 (review) + {} historical runs + 1 knowledge base.", len(TICKETS), len(HISTORICAL_RUNS))
    finally:
        db.close()


if __name__ == "__main__":
    seed()
