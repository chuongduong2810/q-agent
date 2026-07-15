import i18n from "@/i18n";
import type { ProviderKind } from "@/types/api";

/** Provider brand name — intentionally NOT localized (proper nouns, ADR 0011). */
export const providerLabel: Record<ProviderKind, string> = {
  ado: "Azure DevOps",
  jira: "Jira",
  github: "GitHub",
};

/** Stable keys for the cosmetic build steps shown in the AI knowledge-build
 * overlay; the overlay resolves each against the `status:knowledgeSteps.*`
 * catalog. Order is the display order. */
export const KNOWLEDGE_STEPS = [
  "connecting",
  "reading",
  "architecture",
  "stack",
  "findingTests",
  "pageObjects",
  "conventions",
  "building",
  "optimizing",
  "ready",
] as const;

/** [label, color, bg, dot] for a knowledge status pill. Label is localized via
 * the `status` i18n namespace (resolved through the i18next singleton). */
export function knowledgeStatusStyle(status: string): [string, string, string, string] {
  if (status === "indexed") return [i18n.t("status:knowledge.indexed"), "#6ee7b7", "rgba(16,185,129,.12)", "#10b981"];
  if (status === "indexing") return [i18n.t("status:knowledge.indexing"), "#a78bfa", "rgba(139,92,246,.12)", "#8b5cf6"];
  if (status === "stale") return [i18n.t("status:knowledge.stale"), "#fbbf24", "rgba(251,191,36,.1)", "#f59e0b"];
  if (status === "error") return [i18n.t("status:knowledge.error"), "#fb7185", "rgba(244,63,94,.12)", "#f43f5e"];
  return [i18n.t("status:knowledge.none"), "#8b93a7", "rgba(148,163,184,.12)", "#6b7280"];
}

export function confidenceColor(c: number): string {
  return c >= 90 ? "#6ee7b7" : c >= 60 ? "#fbbf24" : "#8b93a7";
}
