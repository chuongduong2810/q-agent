/** Domain types for Q-Agent, mirrored from the design prototype's data model. */

export type Provider = "ado" | "jira" | "github";

export type Screen =
  | "dashboard"
  | "projects"
  | "project"
  | "tickets"
  | "ticket"
  | "runs"
  | "run"
  | "review"
  | "sync"
  | "automation"
  | "console"
  | "evidence"
  | "comment"
  | "reports"
  | "audit"
  | "settings";

export type RunStatus =
  | "processing"
  | "review"
  | "sync"
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

export interface TestStep {
  a: string; // action
  e: string; // expected result
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
