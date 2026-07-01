/**
 * Typed HTTP client for the Q-Agent backend. Thin wrapper over fetch — one
 * method per endpoint in docs/API-CONTRACT.md. Screens consume these through
 * TanStack Query hooks (see src/hooks/) using the keys in src/lib/queryKeys.ts.
 */

import type {
  AiActivity,
  AnnotationShape,
  AutomationSpecOut,
  EvidenceGrouped,
  EvidenceOut,
  ExecutionOut,
  KnowledgeBuildRequest,
  ProjectKnowledgeOut,
  ProjectOut,
  ProviderFieldsIn,
  ProviderKind,
  ProviderOut,
  ReportOut,
  RunCreate,
  RunDetailOut,
  RunOut,
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
  TicketOut,
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

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
}

export const api = {
  // health / observability
  capabilities: () => get<{ claude: boolean; version: string }>("/capabilities"),
  aiActivity: () => get<AiActivity>("/ai/activity"),
  aiWsUrl: () => `${API_BASE.replace(/^http/, "ws")}/ws/ai`,

  // providers + settings
  listProviders: () => get<ProviderOut[]>("/providers"),
  getProvider: (kind: ProviderKind) => get<ProviderOut>(`/providers/${kind}`),
  saveProvider: (kind: ProviderKind, body: ProviderFieldsIn) =>
    put<ProviderOut>(`/providers/${kind}`, body),
  testConnection: (kind: ProviderKind) => post<TestConnectionResult>(`/providers/${kind}/test`),
  listSprints: (kind: ProviderKind) => get<SprintOut[]>(`/providers/${kind}/sprints`),
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

  // tickets
  listTickets: (params: { status?: string; assignee?: string; sprint?: string; q?: string } = {}) =>
    get<TicketOut[]>("/tickets" + qs(params)),
  getTicket: (externalId: string) => get<TicketDetailOut>(`/tickets/${externalId}`),
  syncTickets: (body: SyncRequest) => post<SyncResult>("/tickets/sync", body),

  // runs
  listRuns: () => get<RunOut[]>("/runs"),
  createRun: (body: RunCreate) => post<RunDetailOut>("/runs", body),
  getRun: (runId: number | string) => get<RunDetailOut>(`/runs/${runId}`),
  regenerateRun: (runId: number | string) => post<RunDetailOut>(`/runs/${runId}/regenerate`),

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

  // automation
  generateAutomation: (runId: number | string) =>
    post<AutomationSpecOut[]>(`/runs/${runId}/automation/generate`),
  listSpecs: (runId: number | string) => get<AutomationSpecOut[]>(`/runs/${runId}/automation`),
  getSpec: (caseId: number) => get<AutomationSpecOut>(`/cases/${caseId}/spec`),
  regenerateSpec: (caseId: number) => post<AutomationSpecOut>(`/cases/${caseId}/spec/regenerate`),

  // execution
  startExecution: (runId: number | string, body: { workers?: number; env?: string } = {}) =>
    post<ExecutionOut>(`/runs/${runId}/execution`, body),
  getExecution: (runId: number | string) => get<ExecutionOut>(`/runs/${runId}/execution`),

  // evidence
  getEvidence: (runId: number | string) => get<EvidenceGrouped>(`/runs/${runId}/evidence`),
  annotate: (evidenceId: number, shapes: AnnotationShape[]) =>
    post<EvidenceOut>(`/evidence/${evidenceId}/annotate`, { shapes }),

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

  // artifacts
  artifactUrl: (path: string) => `${API_BASE}/artifacts/${path}`,
  wsUrl: (runId: number | string) =>
    `${API_BASE.replace(/^http/, "ws")}/ws/runs/${runId}`,
};
