"""Dev seed — loads the Surency demo dataset into the local SQLite DB.

This is a DEVELOPMENT convenience for demoing/visual-checking the UI without live
provider credentials. It is NOT a product fallback: nothing in the request path
depends on it. Run with:

    uv run python -m app.seed

It is idempotent-ish: it wipes the demo Run/tickets it owns and re-inserts them.
"""

from __future__ import annotations

from app.db import SessionLocal, init_db, utcnow
from app.logging import logger, setup_logging
from app.models import Provider, Run, RunTicket, TestCase, Ticket

TICKETS = [
    dict(external_id="SUR-1428", provider_kind="ado", title="View list of all broker agencies", status="Ready for QA", priority="High", assignee="Maya Kaur", sprint="Sprint 24", labels=["broker-mgmt", "list-view"], work_item_type="User Story",
         description="As a Surency Internal Admin, I want to view a list of all broker agencies in the system, so that I can find and manage broker agency records.",
         note="The Broker Management section uses a tabbed layout: Broker Agencies and Broker Agents. The expiration date shows the nearest upcoming expiration across all licenses; blank if none.",
         acceptance_criteria=[
             "A Surency Internal Admin sees two tabs — Broker Agencies and Broker Agents — with Broker Agencies active by default.",
             "Each agency row displays name, number, type, next license expiration and status, with an ellipsis actions menu.",
             "When an agency has more than one license, only the nearest upcoming expiration is shown.",
             "When an agency has no licenses, the expiration column is blank.",
             "The ellipsis menu for an Active agency shows a single option: Deactivate.",
             "The ellipsis menu for an Inactive agency shows a single option: Activate.",
             "Typing in search filters by agency name or number.",
             "Selecting a status filter shows only agencies matching that status.",
             "When there are no agencies, a message indicates none have been added.",
             "Clicking a broker agency name navigates to its detail view.",
         ],
         comments=[{"who": "Diego R.", "ini": "DR", "role": "Product", "when": "2 days ago", "text": "Confirmed with compliance — State stays a license-level attribute."},
                   {"who": "Maya Kaur", "ini": "MK", "role": "QA Lead", "when": "1 day ago", "text": "Adding edge coverage for zero-license agencies."}],
         attachments=[{"name": "broker-list-mock.png", "size": "248 KB"}, {"name": "acceptance-notes.pdf", "size": "86 KB"}],
         linked_prs=[{"repo": "surency-web", "num": "2841", "title": "feat(brokers): agency list view + filters", "status": "Open", "color": "#6ee7b7"}]),
    dict(external_id="SUR-1431", provider_kind="ado", title="Broker agency detail screen", status="In Progress", priority="High", assignee="Maya Kaur", sprint="Sprint 24", labels=["broker-mgmt", "detail"], acceptance_criteria=["Detail view shows agency profile", "Licenses list with expirations"]),
    dict(external_id="SUR-1402", provider_kind="jira", title="Deactivate broker agency confirmation dialog", status="Ready for QA", priority="Medium", assignee="Diego R.", sprint="Sprint 24", labels=["broker-mgmt", "modal"], acceptance_criteria=["Confirm dialog appears", "Cancel closes without change"]),
    dict(external_id="SUR-1390", provider_kind="ado", title="License expiration reminder emails", status="Ready for QA", priority="Low", assignee="Priya N.", sprint="Sprint 23", labels=["notifications", "email"], acceptance_criteria=["30-day reminder queued", "7-day reminder queued"]),
    dict(external_id="SUR-1377", provider_kind="jira", title="Broker Agents tab pagination", status="Blocked", priority="Medium", assignee="Maya Kaur", sprint="Sprint 23", labels=["broker-mgmt", "pagination"], acceptance_criteria=["Pagination controls render"]),
]

CASE_BANK = {
    "SUR-1428": [
        ("TC-01", "Broker Management loads with two tabs, Broker Agencies active by default", "High", "Functional", "Playwright", "Web", "Signed in as a Surency Internal Admin.", [("Navigate to the Brokers section.", "Broker Management screen is displayed."), ("Observe the tab bar default selection.", "Broker Agencies active.")]),
        ("TC-02", "Agency row shows name, number, type, next expiration, status + actions", "High", "Functional", "Playwright", "Web", "Broker Agencies tab active.", [("Load the Broker Agencies list.", "One row per agency."), ("Inspect a row.", "Shows name, number, type, expiration, status, ellipsis.")]),
        ("TC-05", "Ellipsis on an Active agency offers Deactivate", "High", "Functional", "Playwright", "Web", "An Active agency exists.", [("Open the ellipsis menu on an Active row.", "Menu shows Deactivate.")]),
        ("TC-06", "Ellipsis on an Inactive agency offers Activate", "High", "Functional", "Playwright", "Mobile", "An Inactive agency exists.", [("Open the ellipsis menu on an Inactive row.", "Menu shows Activate.")]),
        ("TC-07", "Search filters by agency name or number", "High", "Functional", "Playwright", "Web", "List displayed.", [("Type an agency name fragment.", "List filters by name.")]),
        ("TC-09", "Empty state when no agencies exist", "Low", "Empty state", "Manual", "Web", "No agencies in the system.", [("Open the Broker Agencies list.", "Empty-state message shown.")]),
    ],
    "SUR-1402": [
        ("TC-01", "Clicking Deactivate opens a confirmation dialog", "High", "Functional", "Playwright", "Web", "Active agency with ellipsis menu open.", [("Choose Deactivate.", "A confirmation dialog opens.")]),
        ("TC-03", "Confirm deactivates the agency and shows a toast", "High", "Functional", "Playwright", "Web", "Confirmation dialog open.", [("Click Confirm.", "Agency Inactive; toast appears.")]),
        ("TC-04", "Cancel closes the dialog with no change", "Medium", "Functional", "Playwright", "Web", "Confirmation dialog open.", [("Click Cancel.", "Dialog closes; still Active.")]),
    ],
    "SUR-1390": [
        ("TC-01", "Reminder email sent 30 days before expiration", "High", "Functional", "Playwright", "Web", "License expires in 30 days.", [("Run the daily reminder job.", "30-day reminder queued.")]),
        ("TC-02", "Reminder email sent 7 days before expiration", "High", "Functional", "Playwright", "Web", "License expires in 7 days.", [("Run the daily reminder job.", "7-day reminder queued.")]),
        ("TC-06", "Reminder respects the account timezone", "Low", "Functional", "Manual", "Web", "Account timezone US/Pacific.", [("Trigger the scheduled send.", "Sends at 8am local.")]),
    ],
}

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
        # Providers
        db.query(Provider).delete()
        db.add_all([
            Provider(kind="ado", name="Azure DevOps", connected=True,
                     config={"orgUrl": "https://dev.azure.com/surency", "project": "Surency Platform"},
                     secrets={}, last_sync=utcnow()),
            Provider(kind="github", name="GitHub", connected=True,
                     config={"org": "surency-eng", "repo": "surency-web"}, secrets={}, last_sync=utcnow()),
            Provider(kind="jira", name="Jira", connected=False, config={}, secrets={}),
        ])

        # Tickets
        db.query(Ticket).delete()
        for t in TICKETS:
            db.add(Ticket(**t))

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

        db.commit()
        logger.info("Seeded {} tickets, RUN-204 (review) + {} historical runs.", len(TICKETS), len(HISTORICAL_RUNS))
    finally:
        db.close()


if __name__ == "__main__":
    seed()
