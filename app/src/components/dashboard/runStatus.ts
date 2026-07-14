import type { RunOut, RunResult, RunStatus } from "@/types/api";

/** Display status = the pipeline `RunStatus` plus the synthetic `"incomplete"`
 * outcome (tests passed but the run didn't finish a post-execution stage). This
 * is a *presentation* state only — the run's real lifecycle status/failedStage
 * are untouched (ADR 0005 retry still keys on them). */
export type RunDisplayStatus = RunStatus | "incomplete";

/** Pipeline stages that run AFTER the tests have executed. A failure here means
 * post-processing didn't finish — not that the QA (test) result is bad. */
const POST_EXECUTION_STAGES = new Set(["evidence", "comment"]);

/**
 * The headline outcome to display for a run, decoupling the QA verdict from the
 * pipeline lifecycle:
 * - a run marked `failed` at a post-execution stage whose tests actually passed
 *   → `"incomplete"` (distinct from a red `"failed"`);
 * - a finished (`done`) run whose tests failed → `"failed"` (verdict leads, so it
 *   isn't shown as a green "Completed");
 * - otherwise the raw pipeline status (active stages, review, cancelled, …).
 */
export function runEffectiveStatus(run: {
  status: RunStatus | string;
  failedStage?: string | null;
  result?: RunResult;
}): RunDisplayStatus {
  const status = run.status as RunStatus;
  const result = run.result ?? "not_run";
  if (status === "failed") {
    if (result === "passed" && run.failedStage && POST_EXECUTION_STAGES.has(run.failedStage)) {
      return "incomplete";
    }
    return "failed";
  }
  if (status === "done" && (result === "failed" || result === "mixed")) {
    return "failed";
  }
  return status;
}

/** Accent color per run status, matching the design's amber-for-review /
 * emerald-for-done / violet-for-active palette. */
const statusColor: Record<RunDisplayStatus, string> = {
  processing: "#22d3ee",
  review: "#f59e0b",
  sync: "#a78bfa",
  automation: "#a78bfa",
  executing: "#a78bfa",
  evidence: "#a78bfa",
  comment: "#a78bfa",
  done: "#6ee7b7",
  cancelled: "#9ca3af",
  failed: "#fb7185",
  incomplete: "#f59e0b",
};

const statusLabel: Record<RunDisplayStatus, string> = {
  processing: "Processing",
  review: "Review",
  sync: "Create & Link",
  automation: "Automation",
  executing: "Executing",
  evidence: "Evidence",
  comment: "Publishing",
  done: "Done",
  cancelled: "Cancelled",
  failed: "Failed",
  incomplete: "Incomplete",
};

export function runColor(status: RunDisplayStatus): string {
  return statusColor[status] ?? "#a0a0b2";
}

export function runRateLabel(status: RunDisplayStatus): string {
  return statusLabel[status] ?? status;
}

/** Terminal statuses — a run in one of these will never be advanced further by
 * a worker (see ADR 0005). Used to split the Runs list into Active vs History
 * and to decide which lifecycle actions (cancel vs retry) apply. */
const TERMINAL_STATUSES: readonly RunStatus[] = ["done", "cancelled", "failed"];

export function isTerminalRun(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** `"3 tickets · 21 cases"` style meta line for a run card. */
export function runMeta(run: RunOut): string {
  return `${run.ticketIds.length} ticket${run.ticketIds.length === 1 ? "" : "s"}`;
}

export type RunFilterGroup = "active" | "review" | "completed" | "failed" | "other";

/** Which summary/filter bucket a run falls into (design tabs). Pass the
 * *effective* status (see {@link runEffectiveStatus}) so an "incomplete" run
 * (tests passed, pipeline unfinished) groups under "completed" rather than
 * alarming the "failed" tab. Cancelled runs are terminal-but-not-failed →
 * "other" (shown only under "All"). */
export function runGroup(status: RunDisplayStatus): RunFilterGroup {
  if (status === "review") return "review";
  if (status === "done" || status === "incomplete") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "other";
  return "active";
}

/** Short status label + accent color for a row's status badge (design palette). */
const RUN_BADGE: Record<RunDisplayStatus, { label: string; color: string }> = {
  processing: { label: "Analyzing", color: "#a78bfa" },
  review: { label: "In review", color: "#f59e0b" },
  sync: { label: "Creating & linking", color: "#a78bfa" },
  automation: { label: "Automation", color: "#a78bfa" },
  executing: { label: "Executing", color: "#f59e0b" },
  evidence: { label: "Evidence", color: "#22d3ee" },
  comment: { label: "Publishing", color: "#a78bfa" },
  done: { label: "Completed", color: "#10b981" },
  cancelled: { label: "Cancelled", color: "#9ca3af" },
  failed: { label: "Failed", color: "#fb7185" },
  incomplete: { label: "Incomplete", color: "#f59e0b" },
};

export function runBadge(status: RunDisplayStatus): { label: string; color: string } {
  return RUN_BADGE[status] ?? { label: status, color: "#a0a0b2" };
}

/** A run whose worker is actively computing on its own — only the initial
 * analysis pass. Renders the animated spinner. */
export function isWorkingRun(status: RunStatus): boolean {
  return status === "processing";
}

/** A run parked at an interactive stage, waiting for the user to drive it
 * forward (past analysis, not terminal). It isn't computing, so it renders a
 * static "pending" indicator rather than the running spinner. */
export function isPausedRun(status: RunStatus): boolean {
  return !isTerminalRun(status) && status !== "processing";
}

/** Compact relative time for dense rows: "now" / "5m" / "1h" / "1d". */
export function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** Coarse "how long ago" label from an ISO timestamp, matching the design's
 * short relative strings ("now", "2h ago", "1 day ago"). */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
