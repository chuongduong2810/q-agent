import type { RunOut, RunStatus } from "@/types/api";

/** Accent color per run status, matching the design's amber-for-review /
 * emerald-for-done / violet-for-active palette. */
const statusColor: Record<RunStatus, string> = {
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
};

const statusLabel: Record<RunStatus, string> = {
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
};

export function runColor(status: RunStatus): string {
  return statusColor[status] ?? "#a0a0b2";
}

export function runRateLabel(status: RunStatus): string {
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

/** Which summary/filter bucket a run falls into (design tabs). Cancelled runs
 * are terminal-but-not-failed → "other" (shown only under "All"). */
export function runGroup(status: RunStatus): RunFilterGroup {
  if (status === "review") return "review";
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  if (!isTerminalRun(status)) return "active";
  return "other";
}

/** Short status label + accent color for a row's status badge (design palette). */
const RUN_BADGE: Record<RunStatus, { label: string; color: string }> = {
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
};

export function runBadge(status: RunStatus): { label: string; color: string } {
  return RUN_BADGE[status] ?? { label: status, color: "#a0a0b2" };
}

/** A run that is actively computing (renders a spinner) vs. waiting/terminal. */
export function isWorkingRun(status: RunStatus): boolean {
  return !isTerminalRun(status) && status !== "review";
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
