import type {
  Ticket,
  TestCase,
  TicketDetail,
  RunHistoryEntry,
} from "@/types";

/**
 * Static seed data ported verbatim from the approved design prototype
 * (support.js). Acts as the in-memory backend for the MVP frontend.
 */

export const TICKETS: Ticket[] = [
  { id: "SUR-1428", provider: "ado", title: "View list of all broker agencies", status: "Ready for QA", priority: "High", assignee: "Maya Kaur", sprint: "Sprint 24", labels: ["broker-mgmt", "list-view"], acCount: 10 },
  { id: "SUR-1431", provider: "ado", title: "Broker agency detail screen", status: "In Progress", priority: "High", assignee: "Maya Kaur", sprint: "Sprint 24", labels: ["broker-mgmt", "detail"], acCount: 7 },
  { id: "SUR-1402", provider: "jira", title: "Deactivate broker agency confirmation dialog", status: "Ready for QA", priority: "Medium", assignee: "Diego R.", sprint: "Sprint 24", labels: ["broker-mgmt", "modal"], acCount: 5 },
  { id: "SUR-1390", provider: "ado", title: "License expiration reminder emails", status: "Ready for QA", priority: "Low", assignee: "Priya N.", sprint: "Sprint 23", labels: ["notifications", "email"], acCount: 6 },
  { id: "SUR-1377", provider: "jira", title: "Broker Agents tab pagination", status: "Blocked", priority: "Medium", assignee: "Maya Kaur", sprint: "Sprint 23", labels: ["broker-mgmt", "pagination"], acCount: 4 },
];

export const CASE_BANK: Record<string, TestCase[]> = {
  "SUR-1428": [
    { id: "TC-01", title: "Broker Management loads with two tabs, Broker Agencies active by default", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.2s", precond: "Signed in as a Surency Internal Admin.", steps: [{ a: "Navigate to the Brokers section.", e: "Broker Management screen is displayed." }, { a: "Observe the tab bar default selection.", e: "Broker Agencies and Broker Agents tabs shown; Broker Agencies active." }] },
    { id: "TC-02", title: "Agency row shows name, number, type, next expiration, status + actions", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "4.1s", precond: "Broker Agencies tab active.", steps: [{ a: "Load the Broker Agencies list.", e: "The list renders one row per agency." }, { a: "Inspect a row and the actions column.", e: "Row shows name, number, type, next expiration, status and an ellipsis menu." }] },
    { id: "TC-03", title: "Multiple licenses show only the nearest upcoming expiration", priority: "Medium", testType: "Business rule", automation: "Playwright", plat: "Web", dur: "2.8s", precond: "An agency has multiple licenses.", steps: [{ a: "Find the multi-license agency row.", e: "Only the nearest upcoming expiration date is shown." }] },
    { id: "TC-04", title: "No licenses on file leaves the expiration column blank", priority: "Medium", testType: "Edge case", automation: "Playwright", plat: "Web", dur: "2.5s", precond: "An agency has no licenses.", steps: [{ a: "Find the no-license agency row.", e: "The expiration column is blank." }] },
    { id: "TC-05", title: "Ellipsis on an Active agency offers Deactivate", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.6s", precond: "An Active agency exists.", steps: [{ a: "Open the ellipsis menu on an Active row.", e: "Menu shows a single option: Deactivate." }] },
    { id: "TC-06", title: "Ellipsis on an Inactive agency offers Activate", priority: "High", testType: "Functional", automation: "Playwright", plat: "Mobile", dur: "3.9s", precond: "An Inactive agency exists.", steps: [{ a: "Open the ellipsis menu on an Inactive row.", e: "Menu shows a single option: Activate." }] },
    { id: "TC-07", title: "Search filters by agency name or number", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "4.4s", precond: "List displayed.", steps: [{ a: "Type an agency name fragment.", e: "List filters by name." }, { a: "Type an agency number.", e: "List filters by number." }] },
    { id: "TC-08", title: "Status filter narrows the list", priority: "Medium", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.1s", precond: "List displayed.", steps: [{ a: "Select the Active status filter.", e: "Only Active agencies are shown." }] },
    { id: "TC-09", title: "Empty state when no agencies exist", priority: "Low", testType: "Empty state", automation: "Manual", plat: "Web", dur: "—", precond: "No agencies in the system.", steps: [{ a: "Open the Broker Agencies list.", e: "Empty-state message indicates none added yet." }] },
    { id: "TC-10", title: "Clicking an agency name opens its detail view", priority: "High", testType: "Navigation", automation: "Playwright", plat: "Web", dur: "2.7s", precond: "List displayed.", steps: [{ a: "Click a broker agency name.", e: "Navigates to that agency’s detail view." }] },
  ],
  "SUR-1402": [
    { id: "TC-01", title: "Clicking Deactivate opens a confirmation dialog", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "2.9s", precond: "Active agency with ellipsis menu open.", steps: [{ a: "Choose Deactivate from the menu.", e: "A confirmation dialog opens." }] },
    { id: "TC-02", title: "Dialog shows the agency name and warning copy", priority: "Medium", testType: "Functional", automation: "Playwright", plat: "Web", dur: "2.2s", precond: "Confirmation dialog open.", steps: [{ a: "Read the dialog contents.", e: "Dialog names the agency and warns the action is reversible." }] },
    { id: "TC-03", title: "Confirm deactivates the agency and shows a toast", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.4s", precond: "Confirmation dialog open.", steps: [{ a: "Click Confirm.", e: "Agency status becomes Inactive; success toast appears." }] },
    { id: "TC-04", title: "Cancel closes the dialog with no change", priority: "Medium", testType: "Functional", automation: "Playwright", plat: "Web", dur: "2.0s", precond: "Confirmation dialog open.", steps: [{ a: "Click Cancel.", e: "Dialog closes; agency remains Active." }] },
    { id: "TC-05", title: "Deactivating with active licenses shows an extra warning", priority: "Medium", testType: "Business rule", automation: "Playwright", plat: "Web", dur: "2.7s", precond: "Agency has active licenses.", steps: [{ a: "Open the deactivate dialog.", e: "An additional warning about active licenses is shown." }] },
  ],
  "SUR-1390": [
    { id: "TC-01", title: "Reminder email sent 30 days before expiration", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.0s", precond: "Agency license expires in 30 days.", steps: [{ a: "Run the daily reminder job.", e: "A 30-day reminder email is queued." }] },
    { id: "TC-02", title: "Reminder email sent 7 days before expiration", priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.0s", precond: "Agency license expires in 7 days.", steps: [{ a: "Run the daily reminder job.", e: "A 7-day reminder email is queued." }] },
    { id: "TC-03", title: "No email when the agency has no licenses", priority: "Medium", testType: "Edge case", automation: "Playwright", plat: "Web", dur: "2.4s", precond: "Agency has no licenses.", steps: [{ a: "Run the reminder job.", e: "No reminder email is queued." }] },
    { id: "TC-04", title: "Email contains agency name and expiration date", priority: "Medium", testType: "Functional", automation: "Playwright", plat: "Web", dur: "2.6s", precond: "A reminder email is generated.", steps: [{ a: "Inspect the email body.", e: "Body contains the agency name and expiration date." }] },
    { id: "TC-05", title: "Unsubscribed agencies receive no reminders", priority: "Medium", testType: "Business rule", automation: "Playwright", plat: "Web", dur: "2.3s", precond: "Agency opted out of reminders.", steps: [{ a: "Run the reminder job.", e: "No email is queued for the opted-out agency." }] },
    { id: "TC-06", title: "Reminder respects the account timezone", priority: "Low", testType: "Functional", automation: "Manual", plat: "Web", dur: "—", precond: "Account timezone is US/Pacific.", steps: [{ a: "Trigger the scheduled send.", e: "Email sends at 8am in the account timezone." }] },
  ],
};

export const TICKET_DETAIL: TicketDetail = {
  desc: "As a Surency Internal Admin, I want to view a list of all broker agencies in the system, so that I can find and manage broker agency records.",
  note: "The Broker Management section uses a tabbed layout: Broker Agencies and Broker Agents. The expiration date shows the nearest upcoming expiration across all licenses; blank if none. The State column is omitted because agencies hold licenses across multiple states.",
  labels: ["broker-mgmt", "list-view", "admin"],
  comments: [
    { who: "Diego R.", ini: "DR", role: "Product", when: "2 days ago", text: "Confirmed with compliance — State stays a license-level attribute, keep it off the list view." },
    { who: "Maya Kaur", ini: "MK", role: "QA Lead", when: "1 day ago", text: "Adding edge coverage for zero-license agencies and inactive-agency actions." },
  ],
  attachments: [
    { name: "broker-list-mock.png", size: "248 KB" },
    { name: "acceptance-notes.pdf", size: "86 KB" },
  ],
  prs: [
    { repo: "surency-web", num: "2841", title: "feat(brokers): agency list view + filters", status: "Open", color: "#6ee7b7" },
    { repo: "surency-api", num: "1190", title: "feat: nearest-expiration resolver", status: "Merged", color: "#a78bfa" },
  ],
};

export const AC_STATEMENTS: string[] = [
  "A Surency Internal Admin navigating to the Brokers section sees two tabs — Broker Agencies and Broker Agents — with Broker Agencies active by default.",
  "Each agency row displays name, number, type, next license expiration and status, with an ellipsis actions menu.",
  "When an agency has more than one license, only the nearest upcoming expiration is shown.",
  "When an agency has no licenses, the expiration column is blank.",
  "The ellipsis menu for an Active agency shows a single option: Deactivate.",
  "The ellipsis menu for an Inactive agency shows a single option: Activate.",
  "Typing in search filters by agency name or number.",
  "Selecting a status filter shows only agencies matching that status.",
  "When there are no agencies, a message indicates none have been added.",
  "Clicking a broker agency name navigates to its detail view.",
];

export const RUNS_HISTORY: RunHistoryEntry[] = [
  { id: "RUN-203", name: "Auth smoke", meta: "1 ticket · 24 cases", rate: "100%", color: "#10b981", ago: "1h", status: "done" },
  { id: "RUN-201", name: "Full regression", meta: "12 tickets · 218 cases", rate: "96%", color: "#10b981", ago: "1d", status: "done" },
  { id: "RUN-198", name: "Claims portal", meta: "5 tickets · 63 cases", rate: "91%", color: "#f59e0b", ago: "2d", status: "done" },
];

/** Generic fallback cases for tickets without a hand-authored bank entry. */
export function genericCases(title: string): TestCase[] {
  return [
    { id: "TC-01", title: "Happy path — " + title, priority: "High", testType: "Functional", automation: "Playwright", plat: "Web", dur: "3.0s", precond: "Feature is available to the user.", steps: [{ a: "Perform the primary action.", e: "The expected outcome occurs." }] },
    { id: "TC-02", title: "Validation & error handling", priority: "Medium", testType: "Functional", automation: "Playwright", plat: "Web", dur: "2.6s", precond: "Feature is available.", steps: [{ a: "Submit invalid input.", e: "A clear validation message is shown." }] },
    { id: "TC-03", title: "Edge case coverage", priority: "Low", testType: "Edge case", automation: "Manual", plat: "Web", dur: "—", precond: "Boundary condition set up.", steps: [{ a: "Exercise the boundary condition.", e: "The system degrades gracefully." }] },
  ];
}

export function getCases(tid: string): TestCase[] {
  return CASE_BANK[tid] || genericCases(TICKETS.find((t) => t.id === tid)?.title ?? tid);
}
