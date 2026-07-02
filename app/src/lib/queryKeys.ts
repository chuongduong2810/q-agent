/** Central TanStack Query key factory — keeps cache keys consistent across screens. */

export const queryKeys = {
  capabilities: ["capabilities"] as const,
  providers: ["providers"] as const,
  provider: (kind: string) => ["providers", kind] as const,
  sprints: (kind: string) => ["providers", kind, "sprints"] as const,
  workItemMetadata: (kind: string) => ["providers", kind, "work-item-metadata"] as const,
  settings: ["settings"] as const,
  projects: ["projects"] as const,
  knowledgeList: ["projects", "knowledge"] as const,
  projectKnowledge: (key: string) => ["projects", key, "knowledge"] as const,
  tickets: (filters?: Record<string, string | undefined>) =>
    ["tickets", filters ?? {}] as const,
  ticket: (externalId: string) => ["tickets", "detail", externalId] as const,
  linkedCases: (externalId: string) => ["tickets", externalId, "linked-cases"] as const,
  linkStatus: (runId: number | string) => ["runs", runId, "linked"] as const,
  runs: ["runs"] as const,
  run: (runId: number | string) => ["runs", runId] as const,
  runCases: (runId: number | string) => ["runs", runId, "cases"] as const,
  specs: (runId: number | string) => ["runs", runId, "automation"] as const,
  execution: (runId: number | string) => ["runs", runId, "execution"] as const,
  evidence: (runId: number | string) => ["runs", runId, "evidence"] as const,
  report: (runId: number | string) => ["runs", runId, "report"] as const,
  reports: ["reports"] as const,
  comments: (runId: number | string) => ["runs", runId, "comments"] as const,
};
