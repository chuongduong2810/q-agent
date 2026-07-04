import type { ProviderKind } from "@/types/api";

/** Human label for a provider kind. */
export const providerLabel: Record<ProviderKind, string> = {
  ado: "Azure DevOps",
  jira: "Jira",
  github: "GitHub",
};

/** Cosmetic build steps shown in the AI knowledge-build overlay. */
export const KNOWLEDGE_STEPS = [
  "Connecting repository…",
  "Reading documentation…",
  "Understanding project architecture…",
  "Detecting technology stack…",
  "Finding existing Playwright tests…",
  "Discovering page objects…",
  "Learning coding conventions…",
  "Building project knowledge base…",
  "Optimizing AI context…",
  "Knowledge base ready.",
];

/** [label, color, bg, dot] for a knowledge status pill. */
export function knowledgeStatusStyle(status: string): [string, string, string, string] {
  if (status === "indexed") return ["Indexed", "#6ee7b7", "rgba(16,185,129,.12)", "#10b981"];
  if (status === "indexing") return ["Building…", "#a78bfa", "rgba(139,92,246,.12)", "#8b5cf6"];
  if (status === "stale") return ["Needs refresh", "#fbbf24", "rgba(251,191,36,.1)", "#f59e0b"];
  if (status === "error") return ["Build failed", "#fb7185", "rgba(244,63,94,.12)", "#f43f5e"];
  return ["Not indexed", "#8b93a7", "rgba(148,163,184,.12)", "#6b7280"];
}

export function confidenceColor(c: number): string {
  return c >= 90 ? "#6ee7b7" : c >= 60 ? "#fbbf24" : "#8b93a7";
}
