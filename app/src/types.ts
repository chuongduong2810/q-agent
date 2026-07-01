/** Domain types for Q-Agent, mirrored from the design prototype's data model. */

export type Provider = "ado" | "jira" | "github";

export type Screen =
  | "dashboard"
  | "projects"
  | "tickets"
  | "ticket"
  | "runs"
  | "run"
  | "review"
  | "automation"
  | "console"
  | "evidence"
  | "comment"
  | "reports"
  | "settings";

export type RunStatus =
  | "processing"
  | "review"
  | "automation"
  | "executing"
  | "evidence"
  | "comment"
  | "done";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecStatus = "pending" | "running" | "pass" | "fail";
export type PublishStatus = "draft" | "publishing" | "published" | "failed";
export type EvidenceTab = "screenshot" | "video" | "trace" | "console" | "network";
export type AutoPhase = "idle" | "thinking" | "done";
export type RunScope = "selected" | "sprint" | "assigned";

export interface Ticket {
  id: string;
  provider: Exclude<Provider, "github">;
  title: string;
  status: "Ready for QA" | "In Progress" | "Blocked";
  priority: "High" | "Medium" | "Low";
  assignee: string;
  sprint: string;
  labels: string[];
  acCount: number;
}

export interface TestStep {
  a: string; // action
  e: string; // expected result
}

export interface TestCase {
  id: string;
  title: string;
  priority: "High" | "Medium" | "Low";
  testType: string;
  automation: "Playwright" | "Manual" | "Selenium";
  plat: "Web" | "Mobile";
  dur: string;
  precond: string;
  steps: TestStep[];
}

export interface Run {
  id: string;
  name: string;
  scope: string;
  framework: string;
  env: string;
  workers: number;
  tickets: string[];
  status: RunStatus;
}

export interface CaseDraft {
  title: string;
  precond: string;
  steps: TestStep[];
}

export interface ProviderConfig {
  connected: boolean;
  lastSync: string;
  [key: string]: string | boolean;
}

export interface Settings {
  parallel: number;
  retryFlaky: boolean;
  screenshotOnFail: boolean;
  video: boolean;
}

export interface Comment {
  who: string;
  ini: string;
  role: string;
  when: string;
  text: string;
}

export interface TicketDetail {
  desc: string;
  note: string;
  labels: string[];
  comments: Comment[];
  attachments: { name: string; size: string }[];
  prs: { repo: string; num: string; title: string; status: string; color: string }[];
}

export interface RunHistoryEntry {
  id: string;
  name: string;
  meta: string;
  rate: string;
  color: string;
  ago: string;
  status: string;
}
