import type { ProviderKind } from "@/types/api";

/**
 * Showcase project set (from the approved design). Used as the Projects grid /
 * detail fallback until real provider projects populate; knowledge status for
 * each is merged in live from the backend by project name (= knowledge key).
 */
export interface SampleProject {
  name: string;
  provider: string;
  providerKind: ProviderKind;
  repo: string;
  framework: string;
  tickets: number;
  runs: number;
  rate: string;
  active: boolean;
}

export const SAMPLE_PROJECTS: SampleProject[] = [
  { name: "Surency Platform", provider: "Azure DevOps", providerKind: "ado", repo: "surency-eng/surency-web", framework: "Playwright", tickets: 42, runs: 1, rate: "94%", active: true },
  { name: "Surency Mobile", provider: "Azure DevOps", providerKind: "ado", repo: "surency-eng/surency-mobile", framework: "Playwright", tickets: 28, runs: 0, rate: "91%", active: false },
  { name: "Claims Portal", provider: "Jira", providerKind: "jira", repo: "surency-eng/claims-portal", framework: "Playwright", tickets: 63, runs: 0, rate: "97%", active: false },
];

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
  if (status === "stale") return ["Needs refresh", "#fbbf24", "rgba(251,191,36,.1)", "#f59e0b"];
  return ["Not indexed", "#8b93a7", "rgba(148,163,184,.12)", "#6b7280"];
}

export function confidenceColor(c: number): string {
  return c >= 90 ? "#6ee7b7" : c >= 60 ? "#fbbf24" : "#8b93a7";
}
