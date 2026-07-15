import type { ReactNode } from "react";
import i18n from "@/i18n";

/** Colour maps shared across screens (ticket status, priority, approval, exec).
 * Human labels are localized via the `status` i18n namespace and resolved
 * through the i18next singleton (consumers already call `useTranslation`, so
 * they re-render on language switch). */

export const statusColors: Record<string, [string, string]> = {
  "Ready for QA": ["#6ee7b7", "rgba(16,185,129,.14)"],
  "In Progress": ["#fbbf24", "rgba(251,191,36,.13)"],
  Blocked: ["#fb7185", "rgba(244,63,94,.14)"],
  Done: ["#6ee7b7", "rgba(16,185,129,.14)"],
};

const approvalColor: Record<string, [string, string]> = {
  pending: ["#fbbf24", "rgba(251,191,36,.14)"],
  approved: ["#6ee7b7", "rgba(16,185,129,.14)"],
  rejected: ["#fb7185", "rgba(244,63,94,.14)"],
};

/** `[color, label, bg]` for a test-case approval state. */
export function approvalStyle(approval: string): [string, string, string] {
  const [color, bg] = approvalColor[approval] ?? approvalColor.pending;
  return [color, i18n.t(`status:approval.${approval}`, { defaultValue: approval }), bg];
}

const execColor: Record<string, string> = {
  pending: "#6b7280",
  running: "#f59e0b",
  pass: "#10b981",
  fail: "#f43f5e",
  skipped: "#6b7280",
};

/** `[color, label]` for an execution result status. */
export function execStyle(status: string): [string, string] {
  return [execColor[status] ?? execColor.pending, i18n.t(`status:exec.${status}`, { defaultValue: status })];
}

/**
 * Visual token ([color, label]) for a confirmed product defect — a failed case
 * whose `failureClass === "product_defect"`. Deliberately fuchsia (#d946ef), NOT
 * the script-fail red (#f43f5e), so a genuine product bug reads distinctly from a
 * plain test failure. Kept in sync with the Automation slice's product-defect hue.
 */
export function productDefectStyle(): [string, string] {
  return ["#d946ef", i18n.t("status:productDefect")];
}

export function priorityColor(p: string): string {
  return p === "High" ? "#fb7185" : p === "Medium" ? "#fbbf24" : "#94a3b8";
}
export function priorityBg(p: string): string {
  return p === "High"
    ? "rgba(251,113,133,.14)"
    : p === "Medium"
      ? "rgba(251,191,36,.14)"
      : "rgba(148,163,184,.14)";
}

/** Provider glyph + brand colour. */
export const providerGlyph: Record<string, [string, string]> = {
  ado: ["A", "#0078d4"],
  jira: ["J", "#2684ff"],
  github: ["G", "#e5e7eb"],
};

interface PillProps {
  children: ReactNode;
  color: string;
  bg: string;
  dot?: boolean;
}

/** Small rounded status pill. */
export function Pill({ children, color, bg, dot }: PillProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-bold"
      style={{ color, background: bg }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const [color, bg] = statusColors[status] ?? ["#a0a0b2", "rgba(255,255,255,.06)"];
  return (
    <Pill color={color} bg={bg}>
      {status}
    </Pill>
  );
}
