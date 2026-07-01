import type { RunOut, RunStatus } from "@/types/api";

/** Accent color per run status, matching the design's amber-for-review /
 * emerald-for-done / violet-for-active palette. */
const statusColor: Record<RunStatus, string> = {
  processing: "#22d3ee",
  review: "#f59e0b",
  automation: "#a78bfa",
  executing: "#a78bfa",
  evidence: "#a78bfa",
  comment: "#a78bfa",
  done: "#6ee7b7",
};

const statusLabel: Record<RunStatus, string> = {
  processing: "Processing",
  review: "Review",
  automation: "Automation",
  executing: "Executing",
  evidence: "Evidence",
  comment: "Publishing",
  done: "Done",
};

export function runColor(status: RunStatus): string {
  return statusColor[status] ?? "#a0a0b2";
}

export function runRateLabel(status: RunStatus): string {
  return statusLabel[status] ?? status;
}

/** `"3 tickets · 21 cases"` style meta line for a run card. */
export function runMeta(run: RunOut): string {
  return `${run.ticketIds.length} ticket${run.ticketIds.length === 1 ? "" : "s"}`;
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
