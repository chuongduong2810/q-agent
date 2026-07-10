"""Reusable demo dataset — the Surency broker-management sample data.

Single source of truth for the fabricated demo tickets, test-case bank, and the
project knowledge / project config blobs. Both the dev CLI seed
(:mod:`app.seed`) and the product-tour sample-run seeder
(:mod:`app.services.sample_run_service`) build their rows from these constants,
so the two datasets can never drift.

The tuples/dicts here are pure data; the two ``build_*`` helpers assemble fresh
(unattached, un-owned) ORM rows so a caller can ``stamp_owner`` and ``db.add``
them without sharing instances across sessions.
"""

from __future__ import annotations

from app import crypto
from app.db import utcnow
from app.models import ProjectConfig, ProjectKnowledge
from app.models.knowledge import compose_key

# The project the demo tickets, knowledge base and config all belong to.
PROJECT_KEY = "Surency Platform"
# The primary repository whose knowledge base is pre-indexed for the demo.
PRIMARY_REPO = "surency-web"

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

# The learned knowledge-base contents for the primary repo (the ``knowledge``
# JSON blob on the ProjectKnowledge row). Pure data — no runtime dependencies.
KNOWLEDGE_BODY = {
    "branch": "main",
    "stack": ["React 18", "TypeScript", "Vite", "Node 20", ".NET 8 API"],
    "architecture": "Modular monolith — feature modules (Brokers, Claims, Members) over a REST API with a shared design system.",
    "domain": "Broker & agency management, licensing, member onboarding and claims for a benefits administration platform.",
    "locator": "Prefer getByRole + data-testid; fall back to accessible name.",
    "base_url": "https://staging.surency-web.test",
    "routes": [
        {"path": "/brokers", "description": "Broker Management (Agencies/Agents tabs)", "auth_required": True},
        {"path": "/brokers/agencies/:id", "description": "Broker agency detail", "auth_required": True},
        {"path": "/login", "description": "Sign-in", "auth_required": False},
    ],
    "selectors": [
        {"screen": "Broker Management", "element": "Agencies tab", "selector": "getByRole('tab', { name: 'Broker Agencies' })"},
        {"screen": "Broker Management", "element": "Agency search", "selector": "getByTestId('agency-search')"},
        {"screen": "Broker Management", "element": "Row actions menu", "selector": "getByTestId('agency-row-actions')"},
    ],
    "auth": {
        "login_flow": "Email + password form at /login; session cookie persisted via storageState.",
        "login_url": "https://staging.surency-web.test/login",
        "storage_state": "playwright/.auth/internal-admin.json",
    },
    "environments": [
        {"name": "Staging", "base_url": "https://staging.surency-web.test", "notes": "default QA target"},
    ],
    "business_entities": ["Broker Agency", "Broker Agent", "License", "Member", "Claim"],
    "assets": 148,
    "pageObjects": 32,
    "page_object_names": ["LoginPage", "BrokerManagementPage", "AgencyDetailPage"],
    "fixtures": 12,
    "fixture_names": ["authenticatedPage", "seededAgency"],
    "utilities": ["api-client.ts", "auth.setup.ts", "seed-data.ts", "test-users.ts"],
}


def build_project_knowledge() -> ProjectKnowledge:
    """Build a fresh (unattached, un-owned) demo ``ProjectKnowledge`` row.

    The primary repo pre-indexed (per-repo knowledge base) so the Project
    Details view has content. Callers stamp the owner and add it to a session.

    Returns:
        A new ``ProjectKnowledge`` instance for the demo project's primary repo.
    """
    return ProjectKnowledge(
        key=compose_key(PROJECT_KEY, PRIMARY_REPO),
        project_key=PROJECT_KEY,
        name=PROJECT_KEY,
        provider="Azure DevOps",
        repo=PRIMARY_REPO,
        framework="Playwright",
        status="indexed",
        confidence=93,
        version="v3",
        needs_refresh=True,
        last_indexed=utcnow(),
        knowledge=dict(KNOWLEDGE_BODY),
    )


def build_project_config(
    work_item_connection_id: int | None = None,
    repository_connection_id: int | None = None,
) -> ProjectConfig:
    """Build a fresh (unattached, un-owned) demo ``ProjectConfig`` row.

    Populates the Project Details → Settings tab and gives generated specs a real
    base URL + credentials. The test-account password is encrypted at rest.

    Args:
        work_item_connection_id: The work-item provider connection to bind, or
            ``None`` to leave unbound (degrades to first-of-category).
        repository_connection_id: The repository provider connection to bind, or
            ``None`` to leave unbound.

    Returns:
        A new ``ProjectConfig`` instance for the demo project.
    """
    return ProjectConfig(
        key=PROJECT_KEY,
        name=PROJECT_KEY,
        work_item_connection_id=work_item_connection_id,
        repository_connection_id=repository_connection_id,
        base_url="https://staging.surency-web.test",
        repos=[
            {"name": "surency-web", "repo_url": "https://dev.azure.com/surency/Surency%20Platform/_git/surency-web",
             "default_branch": "main", "local_repo_path": "", "default": True},
            {"name": "surency-api", "repo_url": "https://dev.azure.com/surency/Surency%20Platform/_git/surency-api",
             "default_branch": "main", "local_repo_path": "", "default": False},
        ],
        local_repo_path="",
        environments=[
            {"name": "Staging", "base_url": "https://staging.surency-web.test", "notes": "default QA target"},
        ],
        test_accounts=[
            {"role": "Surency Internal Admin", "username": "qa.admin@surency.test",
             "password": crypto.encrypt("Demo-Passw0rd!"), "notes": "primary automation account"},
        ],
        extra={},
    )
