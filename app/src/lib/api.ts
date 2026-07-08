/**
 * Typed HTTP client for the Q-Agent backend. Thin wrapper over fetch — one
 * method per endpoint in docs/API-CONTRACT.md. Screens consume these through
 * TanStack Query hooks (see src/hooks/) using the keys in src/lib/queryKeys.ts.
 */

import type {
  AiActivity,
  AnnotationShape,
  AuditEventOut,
  AuditStats,
  AuthState,
  ClaudeStats,
  AutomationSpecOut,
  AutomationStatus,
  BackendLogOut,
  BackendLogStats,
  CreateLinkRequest,
  LinkedTestCaseOut,
  LinkStatusOut,
  EvidenceGrouped,
  EvidenceOut,
  ExecutionOut,
  HealReport,
  AvailableReposOut,
  ConnectionOut,
  ConnectionUpdate,
  KnowledgeBuildRequest,
  ProjectConfigOut,
  ProjectConfigUpdate,
  ProjectKnowledgeOut,
  ProjectOut,
  RepoKnowledgeOut,
  ProviderGroupOut,
  ProviderKind,
  ReportOut,
  RunCreate,
  RunDetailOut,
  RunAiUsage,
  RunOut,
  RunRepoOption,
  RunTicketOut,
  SettingsOut,
  SettingsUpdate,
  SprintOut,
  SyncRequest,
  SyncResult,
  TestCaseCreate,
  TestCaseOut,
  TestCaseUpdate,
  TestConnectionResult,
  TicketCommentOut,
  TicketDetailOut,
  TicketFilters,
  TicketOut,
  WorkItemMetadataOut,
} from "@/types/api";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8787";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = (body as { detail?: string }).detail ?? detail;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: "PUT", body: JSON.stringify(body ?? {}) });
const patch = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
}

export const api = {
  // health / observability
  capabilities: () => get<{ claude: boolean; version: string }>("/capabilities"),
  aiActivity: () => get<AiActivity>("/ai/activity"),
  aiStats: (force = false) => get<ClaudeStats>(`/ai/stats${force ? "?refresh=true" : ""}`),
  aiWsUrl: () => `${API_BASE.replace(/^http/, "ws")}/ws/ai`,

  // providers + connections (ADR 0006)
  listProviders: () => get<ProviderGroupOut[]>("/providers"),
  createConnection: (kind: ProviderKind, body: { name: string }) =>
    post<ConnectionOut>(`/providers/${kind}/connections`, body),
  updateConnection: (id: number, body: ConnectionUpdate) =>
    put<ConnectionOut>(`/connections/${id}`, body),
  deleteConnection: (id: number) => del<void>(`/connections/${id}`),
  testConnection: (id: number) => post<TestConnectionResult>(`/connections/${id}/test`),
  connectionSprints: (id: number) => get<SprintOut[]>(`/connections/${id}/sprints`),
  connectionWorkItemMetadata: (id: number) =>
    get<WorkItemMetadataOut>(`/connections/${id}/work-item-metadata`),
  connectionRepos: (id: number) => get<AvailableReposOut>(`/connections/${id}/repos`),

  // settings
  getSettings: () => get<SettingsOut>("/settings"),
  updateSettings: (body: SettingsUpdate) => put<SettingsOut>("/settings", body),

  // projects
  listProjects: () => get<ProjectOut[]>("/projects"),
  refreshProjects: () => post<ProjectOut[]>("/projects/refresh"),

  // project knowledge
  listKnowledge: () => get<ProjectKnowledgeOut[]>("/projects/knowledge"),
  getProjectKnowledge: (key: string) =>
    get<ProjectKnowledgeOut>(`/projects/${encodeURIComponent(key)}/knowledge`),
  buildKnowledge: (key: string, body: KnowledgeBuildRequest) =>
    post<ProjectKnowledgeOut>(`/projects/${encodeURIComponent(key)}/knowledge/build`, body),

  // project config (test account, base URL, environments, repos)
  getProjectConfig: (key: string) =>
    get<ProjectConfigOut>(`/projects/${encodeURIComponent(key)}/config`),
  saveProjectConfig: (key: string, body: ProjectConfigUpdate) =>
    put<ProjectConfigOut>(`/projects/${encodeURIComponent(key)}/config`, body),

  // project manual-login (saved browser session)
  getProjectAuth: (key: string) => get<AuthState>(`/projects/${encodeURIComponent(key)}/auth`),
  clearProjectAuth: (key: string) => del<AuthState>(`/projects/${encodeURIComponent(key)}/auth`),
  captureProjectAuth: (key: string) =>
    post<AuthState>(`/projects/${encodeURIComponent(key)}/auth/capture`),

  // project repos + per-repo knowledge
  listProjectRepos: (key: string) =>
    get<RepoKnowledgeOut[]>(`/projects/${encodeURIComponent(key)}/repos`),
  getRepoKnowledge: (key: string, repo: string) =>
    get<ProjectKnowledgeOut>(
      `/projects/${encodeURIComponent(key)}/repos/${encodeURIComponent(repo)}/knowledge`,
    ),
  buildRepoKnowledge: (key: string, repo: string, body: KnowledgeBuildRequest) =>
    post<ProjectKnowledgeOut>(
      `/projects/${encodeURIComponent(key)}/repos/${encodeURIComponent(repo)}/knowledge/build`,
      body,
    ),

  // tickets
  listTickets: (params: TicketFilters = {}) =>
    get<TicketOut[]>("/tickets" + qs(params as Record<string, string | undefined>)),
  getTicket: (externalId: string) => get<TicketDetailOut>(`/tickets/${externalId}`),
  linkedCases: (externalId: string) =>
    get<LinkedTestCaseOut[]>(`/tickets/${encodeURIComponent(externalId)}/linked-cases`),
  syncTickets: (body: SyncRequest) => post<SyncResult>("/tickets/sync", body),

  // runs
  listRuns: () => get<RunOut[]>("/runs"),
  createRun: (body: RunCreate) => post<RunDetailOut>("/runs", body),
  getRun: (runId: number | string) => get<RunDetailOut>(`/runs/${runId}`),
  regenerateRun: (runId: number | string) => post<RunDetailOut>(`/runs/${runId}/regenerate`),
  cancelRun: (runId: number | string) => post<RunOut>(`/runs/${runId}/cancel`),
  retryRun: (runId: number | string) => post<RunOut>(`/runs/${runId}/retry`),
  deleteRun: (runId: number | string) => del<void>(`/runs/${runId}`),
  runRepos: (runId: number | string) => get<RunRepoOption[]>(`/runs/${runId}/repos`),
  runAiUsage: (runId: number | string) => get<RunAiUsage>(`/runs/${runId}/ai-usage`),
  setRunTicketRepo: (runId: number | string, tid: string, repo: string) =>
    post<RunTicketOut>(`/runs/${runId}/tickets/${encodeURIComponent(tid)}/repo`, { repo }),

  // review
  listCases: (runId: number | string) => get<TestCaseOut[]>(`/runs/${runId}/cases`),
  addCase: (runId: number | string, body: TestCaseCreate) =>
    post<TestCaseOut>(`/runs/${runId}/cases`, body),
  updateCase: (caseId: number, body: TestCaseUpdate) => patch<TestCaseOut>(`/cases/${caseId}`, body),
  setApproval: (caseId: number, approval: "approved" | "rejected" | "pending") =>
    post<TestCaseOut>(`/cases/${caseId}/approval`, { approval }),
  regenerateCase: (caseId: number) => post<TestCaseOut>(`/cases/${caseId}/regenerate`),
  approveAll: (runId: number | string) => post<TestCaseOut[]>(`/runs/${runId}/approve-all`),
  approveTicket: (runId: number | string, tid: string) =>
    post<TestCaseOut[]>(`/runs/${runId}/tickets/${tid}/approve`),
  createAndLink: (runId: number | string, body: CreateLinkRequest) =>
    post<LinkStatusOut>(`/runs/${runId}/testcases/create-link`, body),
  linkStatus: (runId: number | string) => get<LinkStatusOut>(`/runs/${runId}/linked`),

  // automation
  generateAutomation: (runId: number | string, force = false) =>
    post<AutomationSpecOut[]>(
      `/runs/${runId}/automation/generate${force ? "?force=true" : ""}`,
    ),
  automationStatus: (runId: number | string) =>
    get<AutomationStatus>(`/runs/${runId}/automation/status`),
  listSpecs: (runId: number | string) => get<AutomationSpecOut[]>(`/runs/${runId}/automation`),
  getSpec: (caseId: number) => get<AutomationSpecOut>(`/cases/${caseId}/spec`),
  regenerateSpec: (caseId: number) => post<AutomationSpecOut>(`/cases/${caseId}/spec/regenerate`),
  updateSpec: (caseId: number, code: string) => patch<AutomationSpecOut>(`/cases/${caseId}/spec`, { code }),
  healSpec: (caseId: number) =>
    post<{ started: boolean; maxAttempts: number }>(`/cases/${caseId}/spec/heal`),
  healStatus: (caseId: number) =>
    get<{ healing: boolean; attempt: number; maxAttempts: number }>(
      `/cases/${caseId}/spec/heal/status`,
    ),
  healReport: (caseId: number) =>
    get<HealReport | Record<string, never>>(`/cases/${caseId}/spec/heal/report`),
  runSpec: (caseId: number) => post<ExecutionOut>(`/cases/${caseId}/spec/run`),

  // execution
  startExecution: (runId: number | string, body: { workers?: number; env?: string } = {}) =>
    post<ExecutionOut>(`/runs/${runId}/execution`, body),
  getExecution: (runId: number | string) => get<ExecutionOut>(`/runs/${runId}/execution`),

  // evidence
  getEvidence: (runId: number | string) => get<EvidenceGrouped>(`/runs/${runId}/evidence`),
  annotate: (evidenceId: number, shapes: AnnotationShape[]) =>
    post<EvidenceOut>(`/evidence/${evidenceId}/annotate`, { shapes }),
  autoAnnotateEvidence: (evidenceId: number) =>
    post<EvidenceOut>(`/evidence/${evidenceId}/auto-annotate`),

  // reports
  buildReport: (runId: number | string) => post<ReportOut>(`/runs/${runId}/report`),
  getReport: (runId: number | string) => get<ReportOut>(`/runs/${runId}/report`),
  listReports: () => get<ReportOut[]>("/reports"),

  // comments / publish
  prepareComments: (runId: number | string) =>
    post<TicketCommentOut[]>(`/runs/${runId}/comments/prepare`),
  listComments: (runId: number | string) => get<TicketCommentOut[]>(`/runs/${runId}/comments`),
  editComment: (commentId: number, body: { body?: string; targetStatus?: string }) =>
    patch<TicketCommentOut>(`/comments/${commentId}`, body),
  publishComment: (commentId: number) => post<TicketCommentOut>(`/comments/${commentId}/publish`),
  publishAll: (runId: number | string, ticketIds: string[] = []) =>
    post<TicketCommentOut[]>(`/runs/${runId}/comments/publish`, { ticketIds }),
  retryComments: (runId: number | string) => post<TicketCommentOut[]>(`/runs/${runId}/comments/retry`),

  // audit log
  auditEvents: (params: { category?: string; actor?: string; q?: string } = {}) =>
    get<AuditEventOut[]>("/audit/events" + qs(params)),
  auditStats: () => get<AuditStats>("/audit/stats"),
  clearAuditEvents: () => del<{ deleted: number }>("/audit/events"),
  backendLogs: (params: { level?: string; service?: string; q?: string } = {}) =>
    get<BackendLogOut[]>("/audit/logs" + qs(params)),
  backendLogStats: () => get<BackendLogStats>("/audit/logs/stats"),

  // artifacts
  artifactUrl: (path: string) => `${API_BASE}/artifacts/${path}`,
  wsUrl: (runId: number | string) =>
    `${API_BASE.replace(/^http/, "ws")}/ws/runs/${runId}`,
};
