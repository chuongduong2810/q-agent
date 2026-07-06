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

export interface KnowledgeRoute {
  path: string;
  description: string;
  authRequired?: boolean;
}
export interface KnowledgeSelector {
  screen: string;
  element: string;
  selector: string;
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
  // NOTE: these mirror the raw stored knowledge JSON keys (snake_case), which the
  // API returns verbatim inside `knowledge`.
  base_url?: string;
  routes?: KnowledgeRoute[];
  selectors?: KnowledgeSelector[];
  auth?: { login_flow?: string; login_url?: string; storage_state?: string };
  environments?: Array<{ name: string; base_url: string; notes: string }>;
  business_entities?: string[];
  page_object_names?: string[];
  fixture_names?: string[];
}

// -------------------------------------------------------------- project config
export interface TestAccountOut {
  role: string;
  username: string;
  notes: string;
  hasPassword: boolean;
}
export interface TestAccountIn {
  role: string;
  username: string;
  password: string; // blank preserves the stored secret
  notes: string;
}
export interface EnvironmentCfg {
  name: string;
  baseUrl: string;
  notes: string;
}
export interface ProjectRepo {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  localRepoPath: string;
  default: boolean;
}
export interface AvailableRepo {
  name: string;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
}
export interface AvailableReposOut {
  provider: string;
  repos: AvailableRepo[];
  error: string;
}
export interface RepoKnowledgeOut {
  name: string;
  repoUrl: string;
  defaultBranch: string;
  localRepoPath: string;
  default: boolean;
  status: KnowledgeStatus;
  confidence: number;
  version: string;
  needsRefresh: boolean;
  lastIndexed: string | null;
  docPath: string;
  lastError: string;
}
export interface ProjectConfigOut {
  key: string;
  name: string;
  baseUrl: string;
  repos: ProjectRepo[];
  localRepoPath: string;
  repoUrl: string;
  environments: EnvironmentCfg[];
  testAccounts: TestAccountOut[];
  extra: Record<string, string>;
  manualAuth: boolean;
}
export interface ProjectConfigUpdate {
  baseUrl?: string;
  repos?: ProjectRepo[];
  localRepoPath?: string;
  repoUrl?: string;
  environments?: EnvironmentCfg[];
  testAccounts?: TestAccountIn[];
  extra?: Record<string, string>;
  manualAuth?: boolean;
}

/** Saved manual-login session state for a project (GET/DELETE /projects/{key}/auth). */
export interface AuthState {
  exists: boolean;
  capturedAt: string | null;
  capturing: boolean;
}

export type KnowledgeStatus = "not_indexed" | "indexing" | "indexed" | "stale" | "error";

export interface ProjectKnowledgeOut {
  key: string;
  projectKey?: string;
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
  lastError?: string;
}

export interface AutomationStatus {
  generating: boolean;
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
  local: boolean;
  error: string;
}

export interface LinkStatusOut {
  status: "idle" | "running" | "done";
  results: LinkTicketResult[];
}

export interface CreateLinkRequest {
  link?: boolean;
  ticketIds?: string[];
  dryRun?: boolean;
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
  repo: string;
  analysis: Record<string, unknown>;
}

export interface RunRepoOption {
  name: string;
  default: boolean;
  status: KnowledgeStatus;
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

export type SpecStatus =
  | "draft"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "product_defect";

export interface AutomationSpecOut {
  id: number;
  testCaseId: number;
  filename: string;
  language: string;
  framework: string;
  code: string;
  status: string;
  blockReason: string;
  gateReport: string;
}

export interface HealAttempt {
  attempt: number;
  status: "pass" | "fail";
  error: string;
  durationMs: number;
  outputTail: string;
  fixed: boolean;
  diff: string;
}

export interface HealReport {
  caseId: number;
  finalStatus: "pass" | "fail";
  maxAttempts: number;
  healedAt: string;
  attempts: HealAttempt[];
}

export interface AuditEventOut {
  id: string;
  ts: string;
  category: string;
  actor: string;
  actorType: "user" | "ai" | "system";
  action: string;
  target: string;
  ip: string;
  status: "success" | "warning" | "error";
  meta: string;
}

export interface AuditStats {
  eventsToday: number;
  aiActions: number;
  userActions: number;
  failures: number;
}

export interface BackendLogOut {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  service: string;
  message: string;
  durationMs: number | null;
  trace: string;
}

export interface BackendLogStats {
  logVolume: number;
  servicesHealthy: number;
  servicesTotal: number;
  warnings: number;
  errors: number;
}

export type ExecCaseStatus = "pending" | "running" | "pass" | "fail" | "skipped";

export type FailureClass =
  | ""
  | "test_defect"
  | "product_defect"
  | "flaky"
  | "environment"
  | "timeout";

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
  failureClass: string;
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
  log: string;
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
  headless: boolean;
  userName: string;
  userRole: string;
  autoAnnotate: boolean;
  neuralBackground: boolean;
  claudeModel: string;
  weeklyTokenBudget: number;
}
export type SettingsUpdate = Partial<SettingsOut>;

/** A single rolling usage window (session or week) for the top-bar panel. */
export interface UsageWindow {
  costUsd: number; // spend in this window, USD
  tokens: number; // total tokens in this window
  requests: number; // request count in this window
  resetsAt: string; // ISO (UTC); render in local tz
  pctUsed: number; // plan-limit % used (from the CLI's /usage); -1 = unknown
  resetLabel: string; // authoritative reset text from the CLI (e.g. "Jul 7, 3:20am (Asia/Saigon)"); "" = none
}

/** Per-model usage rollup for the panel's "By model" list. */
export interface ByModelUsage {
  model: string; // "claude-sonnet-5"
  modelLabel: string; // "Claude Sonnet 5"
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

/** Claude usage stats for the top-bar chip + panel (GET /ai/stats). */
export interface ClaudeStats {
  model: string; // "claude-sonnet-5"
  modelLabel: string; // "Claude Sonnet 5"
  operational: boolean;
  ctxWindow: string; // "200K"
  session: UsageWindow; // current rolling session
  week: UsageWindow; // current rolling week
  breakdown: { input: number; output: number; cacheRead: number; cacheWrite: number };
  byModel: ByModelUsage[];
  limitsStatus: "loading" | "ready" | "unavailable"; // state of the CLI /usage % fetch
}

/** One AI process (ticket-analysis phase, automation, etc.) and its token spend. */
export interface RunAiProcess {
  key: string; // stable process kind ("analyze" | "generate" | "automation" | …)
  name: string; // display label
  meta: string; // sub-line (e.g. "12 tickets · 34 cases")
  input: number; // input tokens
  output: number; // output tokens
  tokens: number; // total tokens
  costUsd: number; // spend in USD
}

/** Per-process AI usage + cost for a run (GET /runs/{id}/ai-usage). */
export interface RunAiUsage {
  runId: number;
  modelLabel: string; // "Claude Sonnet 4.6"
  totalCostUsd: number;
  totalTokens: number;
  processes: RunAiProcess[]; // sorted by costUsd desc; [] if none
}

/** Evidence grouped-by-ticket response for GET /runs/{id}/evidence. */
export interface EvidenceGrouped {
  tickets: Array<{
    id: string;
    title: string;
    pass: number;
    fail: number;
    /** Approved, automatable cases on the ticket — the denominator for "passed". */
    approved: number;
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
