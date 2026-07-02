/**
 * Wire types mirroring the backend Pydantic schemas (api/app/schemas.py).
 * All fields are camelCase — the backend serializes with a camelCase alias
 * generator. Keep this file in sync with docs/API-CONTRACT.md.
 */

export type ProviderKind = "ado" | "jira" | "github";

export interface ProviderOut {
  id: number;
  kind: ProviderKind;
  name: string;
  connected: boolean;
  config: Record<string, string>;
  secretFields: string[];
  lastSync: string | null;
}

export interface ProviderFieldsIn {
  config?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  detail: Record<string, unknown>;
}

export interface ProjectOut {
  id: number;
  providerKind: ProviderKind;
  externalId: string;
  name: string;
  active: boolean;
  meta: Record<string, unknown>;
}

export interface KnowledgeBody {
  branch: string;
  stack: string[];
  architecture: string;
  domain: string;
  locator: string;
  assets: number;
  pageObjects: number;
  fixtures: number;
  utilities: string[];
}

export type KnowledgeStatus = "not_indexed" | "indexed" | "stale";

export interface ProjectKnowledgeOut {
  key: string;
  name: string;
  provider: string;
  repo: string;
  framework: string;
  status: KnowledgeStatus;
  confidence: number;
  version: string;
  needsRefresh: boolean;
  lastIndexed: string | null;
  knowledge: Partial<KnowledgeBody>;
  docPath: string;
}

export interface KnowledgeBuildRequest {
  name?: string;
  provider?: string;
  repo?: string;
  framework?: string;
}

export interface PullRequestOut {
  repo: string;
  num: string;
  title: string;
  status: string;
  color: string;
}
export interface CommentOut {
  who: string;
  ini: string;
  role: string;
  when: string;
  text: string;
}
export interface AttachmentOut {
  name: string;
  size: string;
}

export interface TicketOut {
  id: number;
  externalId: string;
  providerKind: ProviderKind;
  title: string;
  workItemType: string;
  status: string;
  priority: string;
  assignee: string;
  sprint: string;
  areaPath: string;
  labels: string[];
  acCount: number;
}

export interface AreaPathOut {
  id: string;
  name: string;
  path: string;
}
export interface WorkItemMetadataOut {
  areaPaths: AreaPathOut[];
  workItemTypes: string[];
  states: string[];
}

export interface TicketDetailOut extends TicketOut {
  description: string;
  note: string;
  acceptanceCriteria: string[];
  comments: CommentOut[];
  attachments: AttachmentOut[];
  linkedPrs: PullRequestOut[];
}

export interface SprintOut {
  id: string;
  name: string;
  path: string; // ADO iteration path (Project\Sprint) or Jira sprint id
  startDate?: string | null;
  finishDate?: string | null;
  state?: string | null;
}

export interface SyncRequest {
  providerKind: ProviderKind;
  mode?: string;
  sprint?: string | null;
  sprintPath?: string | null;
  areaPath?: string | null;
  states?: string[];
  workItemTypes?: string[];
  ticketIds?: string[];
}

export interface TicketFilters {
  status?: string;
  assignee?: string;
  sprint?: string;
  areaPath?: string;
  states?: string;
  workItemTypes?: string;
  q?: string;
}
export interface SyncResult {
  synced: number;
  tickets: TicketOut[];
}

export interface TestStep {
  a: string;
  e: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface TestCaseOut {
  id: number;
  runId: number;
  ticketExternalId: string;
  code: string;
  title: string;
  precondition: string;
  steps: TestStep[];
  priority: string;
  testType: string;
  automation: string;
  platform: string;
  duration: string;
  approval: ApprovalStatus;
  source: string;
  edited: boolean;
}

export interface TestCaseUpdate {
  title?: string;
  precondition?: string;
  steps?: TestStep[];
  priority?: string;
  testType?: string;
  automation?: string;
}
export interface TestCaseCreate {
  ticketExternalId: string;
  title: string;
  precondition?: string;
  steps?: TestStep[];
  priority?: string;
  testType?: string;
  automation?: string;
  platform?: string;
}

export interface LinkedTestCaseOut {
  id: number;
  ticketExternalId: string;
  providerKind: string;
  externalId: string;
  title: string;
  status: string;
  url: string;
  linked: boolean;
  updatedAt: string | null;
}

export interface LinkTicketResult {
  ticketExternalId: string;
  providerKind: string;
  count: number;
  created: boolean;
  linked: boolean;
  error: string;
}

export interface LinkStatusOut {
  status: "idle" | "running" | "done";
  results: LinkTicketResult[];
}

export interface CreateLinkRequest {
  link?: boolean;
  ticketIds?: string[];
}

export type RunStatus =
  | "processing"
  | "review"
  | "sync"
  | "automation"
  | "executing"
  | "evidence"
  | "comment"
  | "done";

export interface RunTicketOut {
  ticketExternalId: string;
  position: number;
  genStatus: string;
  analysis: Record<string, unknown>;
}

export interface RunOut {
  id: number;
  code: string;
  name: string;
  scope: string;
  scopeLabel: string;
  framework: string;
  browser: string;
  env: string;
  workers: number;
  retryPolicy: number;
  status: RunStatus;
  createdAt: string;
  ticketIds: string[];
}
export interface RunDetailOut extends RunOut {
  runTickets: RunTicketOut[];
}

export interface RunCreate {
  scope?: string;
  ticketIds?: string[];
  framework?: string;
  browser?: string;
  env?: string;
  workers?: number;
  retryPolicy?: number;
  sprint?: string | null;
  sprintPath?: string | null;
}

export interface AutomationSpecOut {
  id: number;
  testCaseId: number;
  filename: string;
  language: string;
  framework: string;
  code: string;
}

export type ExecCaseStatus = "pending" | "running" | "pass" | "fail" | "skipped";

export interface EvidenceOut {
  id: number;
  kind: string;
  filename: string;
  path: string;
  sizeBytes: number;
  annotated: boolean;
  meta: Record<string, unknown>;
}

export interface ExecutionResultOut {
  id: number;
  testCaseId: number;
  ticketExternalId: string;
  caseCode: string;
  title: string;
  status: ExecCaseStatus;
  durationMs: number;
  errorMessage: string;
  consoleLogs: Array<Record<string, unknown>>;
  networkLogs: Array<Record<string, unknown>>;
  evidence: EvidenceOut[];
}

export interface ExecutionOut {
  id: number;
  runId: number;
  status: string;
  env: string;
  browser: string;
  workers: number;
  total: number;
  passed: number;
  failed: number;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  results: ExecutionResultOut[];
}

export interface AnnotationShape {
  tool: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
}

export interface ReportOut {
  id: number;
  runId: number;
  executionId: number | null;
  overallResult: string;
  passRate: number;
  passed: number;
  failed: number;
  durationS: number;
  env: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export type PublishStatus = "draft" | "publishing" | "published" | "failed";
export interface TicketCommentOut {
  id: number;
  runId: number;
  ticketExternalId: string;
  providerKind: ProviderKind;
  body: string;
  status: PublishStatus;
  targetStatus: string;
  externalCommentId: string;
  errorMessage: string;
}

export interface SettingsOut {
  parallel: number;
  retryFlaky: boolean;
  screenshotOnFail: boolean;
  video: boolean;
  maxCasesPerTicket: number;
}
export type SettingsUpdate = Partial<SettingsOut>;

/** Evidence grouped-by-ticket response for GET /runs/{id}/evidence. */
export interface EvidenceGrouped {
  tickets: Array<{
    id: string;
    title: string;
    pass: number;
    fail: number;
    provGlyph: string;
    provColor: string;
    statusLabel: string;
  }>;
  byTicket: Record<string, ExecutionResultOut[]>;
}

/** Claude CLI activity (observability). */
export interface AiCall {
  id: number;
  label: string;
  skill?: string | null;
  status: "running" | "ok" | "error";
  startedAt: string;
  durationMs?: number;
  error?: string;
}
export interface AiActivity {
  running: AiCall[];
  recent: AiCall[];
}

/** WebSocket progress message shape. */
export interface ProgressEvent {
  event: string;
  runId: string;
  payload: Record<string, unknown>;
}
