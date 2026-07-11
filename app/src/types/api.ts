/**
 * Wire types mirroring the backend Pydantic schemas (api/app/schemas.py).
 * All fields are camelCase — the backend serializes with a camelCase alias
 * generator. Keep this file in sync with docs/API-CONTRACT.md.
 */

export type ProviderKind = "ado" | "jira" | "github";

/** Providers split into two categories: work-item sources (tickets) vs
 * repository sources (code). A project binds one connection of each. */
export type ProviderCategory = "work_item" | "repository";

/** A single named connection under a provider kind (ADR 0006). `categories`
 * lists every capability the connection's kind provides — e.g. Azure DevOps
 * is `["work_item", "repository"]` — so a per-project picker offers it when
 * its capability is included. */
export interface ConnectionOut {
  id: number;
  kind: ProviderKind;
  categories: ProviderCategory[];
  name: string;
  connected: boolean;
  config: Record<string, string>;
  secretFields: string[];
  lastSync: string | null;
  lastTestedAt: string | null;
}

/** Grouped provider catalog entry: one kind with its N connections. */
export interface ProviderGroupOut {
  kind: ProviderKind;
  categories: ProviderCategory[];
  name: string;
  connectionCount: number;
  connectedCount: number;
  connections: ConnectionOut[];
}

/** Body for PUT /connections/{id}. Untouched secrets are omitted so the backend
 * keeps the existing encrypted value. */
export interface ConnectionUpdate {
  name?: string;
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
  /** The work-item connection this project's tickets come from (ADR 0006). */
  workItemConnectionId: number | null;
  /** The repository connection this project's code lives on (ADR 0006). */
  repositoryConnectionId: number | null;
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
  workItemConnectionId?: number | null;
  repositoryConnectionId?: number | null;
}

/** Saved manual-login session state for a project (GET/DELETE /projects/{key}/auth). */
export interface AuthState {
  exists: boolean;
  capturedAt: string | null;
  capturing: boolean;
}

// ---------------------------------------------------- shared namespace (ADR 0009)
/** One repo's (or the bare project's, when `repo` is blank) knowledge status
 * within a shared-catalog entry (`GET /shared/projects`). */
export interface SharedProjectKnowledgeOut {
  repo: string;
  status: KnowledgeStatus;
  confidence: number;
  version: string;
  lastIndexed: string | null;
}

/** A shared-namespace project the catalog lists for members to browse/clone. */
export interface SharedProjectOut {
  key: string;
  name: string;
  providerKind: string;
  hasConfig: boolean;
  baseUrl: string;
  repos: ProjectRepo[];
  workItemConnectionId: number | null;
  repositoryConnectionId: number | null;
  knowledge: SharedProjectKnowledgeOut[];
  alreadyCloned: boolean;
}

/** Admin: create/update the shared project shell + its config
 * (`POST /shared/projects/{key}`). */
export interface SharedProjectCreate {
  name?: string;
  providerKind?: string;
  externalId?: string;
  baseUrl?: string;
  repos?: ProjectRepo[];
  workItemConnectionId?: number | null;
  repositoryConnectionId?: number | null;
  environments?: EnvironmentCfg[];
  testAccounts?: TestAccountIn[];
  extra?: Record<string, string>;
  manualAuth?: boolean;
}

/** Summary of what `POST /shared/projects/{key}/clone` copied. */
export interface CloneResultOut {
  projectKey: string;
  projectsCloned: number;
  configCloned: boolean;
  knowledgeCloned: string[];
  artifactsCopied: string[];
  docPath: string;
  lastError: string;
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
  /** The work-item connection this ticket was synced from (ADR 0006). */
  connectionId: number | null;
  title: string;
  workItemType: string;
  status: string;
  priority: string;
  assignee: string;
  sprint: string;
  areaPath: string;
  /** Jira epic key/name (empty for ADO or unlinked tickets). */
  epic: string;
  labels: string[];
  acCount: number;
}

/** Paginated envelope for GET /tickets. */
export interface TicketPage {
  items: TicketOut[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AreaPathOut {
  id: string;
  name: string;
  path: string;
}
export interface EpicOut {
  key: string;
  name: string;
}
export interface WorkItemMetadataOut {
  areaPaths: AreaPathOut[];
  workItemTypes: string[];
  states: string[];
  epics: EpicOut[];
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
  /** The work-item connection to sync from (ADR 0006). Falls back on the
   * backend to the project binding, then first-of-kind. */
  connectionId?: number;
  providerKind?: ProviderKind;
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
  /** Scope the list to a single work-item connection (ADR 0006). */
  connectionId?: number;
  providerKind?: ProviderKind;
  priority?: string;
  /** Jira epic key. */
  epic?: string;
  /** 1-based page number; defaults to 1 on the backend. */
  page?: number;
  /** Page size; defaults to 25 on the backend. */
  pageSize?: number;
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
  | "done"
  | "cancelled"
  | "failed";

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
  finishedAt?: string;
  cancelledAt?: string;
  failedStage?: string;
  ticketIds: string[];
  /** Number of test cases in the run. */
  caseCount: number;
  /** Cases in the latest execution (the "passed / N" denominator). */
  total: number;
  /** Passed cases in the latest execution. */
  passed: number;
  /** Pass rate (0..100) from the latest report; null until finalized. */
  passRate: number | null;
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

/** Where an Execution runs — the server (legacy) or a paired Local Agent
 * device on the user's own machine. */
export type ExecutionTarget = "server" | "local-agent";

export interface ExecutionOut {
  id: number;
  runId: number;
  status: string;
  target: ExecutionTarget;
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

/** A paired Local Agent device (`GET /agent/devices`). */
export interface AgentDeviceOut {
  id: number;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Response from `POST /agent/devices/pair-code` — a short-lived code the
 * user hands to `npx @q-agent/agent pair <code>` on their machine. */
export interface PairCodeOut {
  code: string;
  expiresIn: number;
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
  autoAnnotate: boolean;
  neuralBackground: boolean;
  claudeModel: string;
  weeklyTokenBudget: number;
  /** Default execution target for new runs — the server, or a paired Local
   * Agent on the user's machine. Configured on the Settings screen. */
  executionTarget: ExecutionTarget;
}
export type SettingsUpdate = Partial<SettingsOut>;

/* ── Auth (ADR 0007) ─────────────────────────────────────────────────────
 * camelCase wire shapes for the multi-user auth vertical. The durable
 * credential is an httpOnly refresh cookie; the access token is in-memory. */

export type UserRole = "admin" | "member";

/** The authenticated principal (GET /auth/me, embedded in login/refresh). */
export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  /** Whether the user has an active TOTP (authenticator app) enrollment. */
  totpEnabled: boolean;
  /** Stamped on successful login/refresh (#95); `null` if never. */
  lastActive: string | null;
}

/** `User` plus admin-only fields — GET /auth/users (#95). */
export interface AdminUser extends User {
  /** "personal" (has own credential), "shared" (falls back to the shared
   * credential), or "none" (nothing resolves for this user). */
  credentialSource: "personal" | "shared" | "none";
}

/** One active refresh session for the profile "Active sessions" list. */
export interface AuthSession {
  id: string;
  userAgent: string;
  ip: string;
  lastSeenAt: string;
  /** True for the session backing the current browser. */
  current: boolean;
}

/** Response to `POST /auth/users/invite` (#94) — the invited user plus a
 * dev-stub reset token (email delivery isn't wired; `null` in prod). */
export interface InviteUserResponse {
  user: User;
  resetToken: string | null;
}

/** A minted access token plus its principal (login success / refresh). */
export interface AuthTokens {
  accessToken: string;
  user: User;
}

/** POST /auth/login → either a session, or an MFA challenge to complete. */
export type LoginResponse = AuthTokens | { mfaRequired: true; mfaToken: string };

/** TOTP enrollment material returned by POST /auth/2fa/setup. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}

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

/** Claude CLI credentials status (#95) — GET /ai/credentials. Never carries the
 * token itself; `mode` is which credential is actually effective for the
 * signed-in user (own beats shared). */
export interface ClaudeCredentialsStatus {
  hasOwn: boolean;
  hasShared: boolean;
  mode: "own" | "shared" | "none";
  own: ClaudeCredentialsMeta | null;
  shared: ClaudeCredentialsMeta | null;
}

/** Per-credential metadata parsed from an uploaded `.credentials.json`. Never
 * carries the token itself. */
export interface ClaudeCredentialsMeta {
  /** "active" | "expired" — "expired" once a real call reported the token dead. */
  status: string;
  /** Account identity from the CLI's .claude.json — null until a call has run. */
  accountEmail: string | null;
  accountOrg: string | null;
  subscriptionType: string | null;
  expiresAt: string | null; // ISO
  scopes: string[];
  lastRefreshed: string | null; // ISO — the row's updated_at
  /** Active users with no own credential — only populated for the shared row. */
  assignedUsers: number | null;
}

/** Result of POST /ai/credentials/test — a real minimal Claude call. */
export interface ClaudeCredentialsTestResult {
  ok: boolean;
  result: "ok" | "invalid" | "no_credential" | "error";
  message: string;
}

/** Body for PUT /ai/credentials and PUT /ai/credentials/shared — the raw
 * contents of a Claude CLI `.credentials.json` file. */
export interface ClaudeCredentialsUpload {
  credentials: string;
  label?: string;
}

/** WebSocket progress message shape. */
export interface ProgressEvent {
  event: string;
  runId: string;
  payload: Record<string, unknown>;
}
