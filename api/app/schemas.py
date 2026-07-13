"""Pydantic v2 schemas — the HTTP wire contract shared by backend + frontend.

Field names are camelCase on the wire (via alias) to match the TypeScript client
and the design's data shapes, while staying snake_case in Python.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base: populate from ORM attrs, serialize camelCase, accept either casing."""

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
    )


# ---------------------------------------------------------------- Providers
class ConnectionOut(ApiModel):
    """A single named provider connection (secrets masked to field names only)."""

    id: int
    kind: str
    categories: list[str]  # work_item, repository — a kind may carry both
    name: str
    connected: bool
    config: dict = Field(default_factory=dict)
    secret_fields: list[str] = Field(default_factory=list)
    last_sync: datetime | None = None
    last_tested_at: datetime | None = None


class ProviderGroupOut(ApiModel):
    """A provider kind and its connections (grouped catalog for Settings)."""

    kind: str
    categories: list[str]
    name: str
    connection_count: int = 0
    connected_count: int = 0
    connections: list[ConnectionOut] = Field(default_factory=list)


class ConnectionCreate(ApiModel):
    """Create an empty connection under a provider kind."""

    name: str = ""


class ConnectionUpdate(ApiModel):
    """Patch a connection. Untouched secrets are omitted (not blanked)."""

    name: str | None = None
    config: dict[str, str] | None = None
    secrets: dict[str, str] | None = None  # plaintext in, encrypted at rest


class TestConnectionResult(ApiModel):
    ok: bool
    message: str
    detail: dict = Field(default_factory=dict)


# ---------------------------------------------------------------- Projects
class ProjectOut(ApiModel):
    id: int
    provider_kind: str
    external_id: str
    name: str
    active: bool
    meta: dict = Field(default_factory=dict)


class ConnectionProjectOut(ApiModel):
    """A single project available under a work-item connection's org.

    Populates the Sync dialog's Project dropdown — the org's projects for the
    chosen connection, so a sync can target a project other than the connection's
    configured default.
    """

    external_id: str
    name: str
    state: str = ""


class KnowledgeBody(ApiModel):
    """The learned knowledge base contents (what project-bootstrap produces).

    ``model_config`` allows extra keys so the richer, discovered fields
    (base_url, routes, selectors, auth, environments, business_entities, …)
    survive round-trips without each needing an explicit field here.
    """

    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
        extra="allow",
    )

    branch: str = "main"
    stack: list[str] = Field(default_factory=list)
    architecture: str = ""
    domain: str = ""
    locator: str = ""
    assets: int = 0
    page_objects: int = 0
    fixtures: int = 0
    utilities: list[str] = Field(default_factory=list)
    base_url: str = ""
    routes: list[dict] = Field(default_factory=list)
    selectors: list[dict] = Field(default_factory=list)
    auth: dict = Field(default_factory=dict)
    environments: list[dict] = Field(default_factory=list)
    business_entities: list[str] = Field(default_factory=list)


# ---------------------------------------------------------- Project config
class TestAccountIn(ApiModel):
    """A test account submitted from the Project Details page (password plaintext in)."""

    role: str = ""
    username: str = ""
    password: str = ""  # blank preserves the stored secret
    notes: str = ""


class TestAccountOut(ApiModel):
    """A test account returned to the UI — password is never included."""

    role: str = ""
    username: str = ""
    notes: str = ""
    has_password: bool = False


class EnvironmentCfg(ApiModel):
    name: str = ""
    base_url: str = ""
    notes: str = ""


class ProjectRepo(ApiModel):
    """A repository that belongs to a project (an ADO/GitHub project holds many)."""

    name: str
    repo_url: str = ""
    default_branch: str = ""
    local_repo_path: str = ""
    default: bool = False  # the repo automation targets by default


class ProjectConfigOut(ApiModel):
    key: str
    name: str = ""
    # Per-project provider bindings (ADR 0006).
    work_item_connection_id: int | None = None
    repository_connection_id: int | None = None
    base_url: str = ""
    repos: list[ProjectRepo] = Field(default_factory=list)
    # Legacy single-repo fields (kept for backward compatibility).
    local_repo_path: str = ""
    repo_url: str = ""
    environments: list[EnvironmentCfg] = Field(default_factory=list)
    test_accounts: list[TestAccountOut] = Field(default_factory=list)
    extra: dict = Field(default_factory=dict)
    # Capture a real (headed) browser login before running specs when no saved session exists.
    manual_auth: bool = False


class ProjectConfigUpdate(ApiModel):
    work_item_connection_id: int | None = None
    repository_connection_id: int | None = None
    base_url: str | None = None
    repos: list[ProjectRepo] | None = None
    local_repo_path: str | None = None
    repo_url: str | None = None
    environments: list[EnvironmentCfg] | None = None
    test_accounts: list[TestAccountIn] | None = None
    extra: dict | None = None
    manual_auth: bool | None = None


class AuthStateOut(ApiModel):
    """State of a project's saved manual-login session (storageState.json)."""

    exists: bool = False
    captured_at: datetime | None = None
    capturing: bool = False


class ProjectKnowledgeOut(ApiModel):
    key: str
    project_key: str = ""
    name: str
    provider: str = ""
    repo: str = ""
    framework: str = "Playwright"
    status: str = "not_indexed"
    confidence: int = 0
    version: str = "v1"
    needs_refresh: bool = False
    last_indexed: datetime | None = None
    knowledge: dict = Field(default_factory=dict)
    doc_path: str = ""
    last_error: str = ""


class KnowledgeBuildRequest(ApiModel):
    name: str | None = None
    provider: str | None = None
    repo: str | None = None
    framework: str | None = None


# ------------------------------------------------------- Project repositories
class AvailableRepoOut(ApiModel):
    """A repo discovered from the project's provider (for the picker)."""

    name: str
    clone_url: str = ""
    web_url: str = ""
    default_branch: str = ""


class AvailableReposOut(ApiModel):
    provider: str = ""
    repos: list[AvailableRepoOut] = Field(default_factory=list)
    error: str = ""


class RepoKnowledgeOut(ApiModel):
    """A project's repo plus the status of its per-repo knowledge base."""

    name: str
    repo_url: str = ""
    default_branch: str = ""
    local_repo_path: str = ""
    default: bool = False
    status: str = "not_indexed"
    confidence: int = 0
    version: str = "v1"
    needs_refresh: bool = False
    last_indexed: datetime | None = None


# ------------------------------------------------------- Shared namespace (#120)
class SharedProjectKnowledgeOut(ApiModel):
    """One repo's (or the bare project's, when ``repo`` is blank) knowledge status
    within a shared-catalog entry."""

    repo: str = ""
    status: str = "not_indexed"
    confidence: int = 0
    version: str = "v1"
    last_indexed: datetime | None = None


class SharedProjectOut(ApiModel):
    """A shared-namespace project the catalog lists for members to browse/clone."""

    key: str
    name: str
    provider_kind: str = ""
    has_config: bool = False
    base_url: str = ""
    repos: list[ProjectRepo] = Field(default_factory=list)
    work_item_connection_id: int | None = None
    repository_connection_id: int | None = None
    knowledge: list[SharedProjectKnowledgeOut] = Field(default_factory=list)
    already_cloned: bool = False


class SharedProjectCreate(ApiModel):
    """Admin: create/update the shared project shell + its config (ADR 0009 §2)."""

    name: str = ""
    provider_kind: str = ""
    external_id: str = ""
    base_url: str = ""
    repos: list[ProjectRepo] = Field(default_factory=list)
    # Connections used only to build shared knowledge — dropped on clone (ADR 0009 §4).
    work_item_connection_id: int | None = None
    repository_connection_id: int | None = None
    environments: list[EnvironmentCfg] = Field(default_factory=list)
    test_accounts: list[TestAccountIn] = Field(default_factory=list)
    extra: dict = Field(default_factory=dict)
    manual_auth: bool = False


class CloneResultOut(ApiModel):
    """Summary of what a clone copied (ADR 0009 §4)."""

    project_key: str
    projects_cloned: int = 0
    config_cloned: bool = False
    knowledge_cloned: list[str] = Field(default_factory=list)
    artifacts_copied: list[str] = Field(default_factory=list)
    doc_path: str = ""
    last_error: str = ""


# ---------------------------------------------------------------- Tickets
class PullRequestOut(ApiModel):
    repo: str
    num: str
    title: str
    status: str
    color: str = "#a78bfa"


class CommentOut(ApiModel):
    who: str
    ini: str = ""
    role: str = ""
    when: str = ""
    text: str


class AttachmentOut(ApiModel):
    name: str
    size: str = ""


class TicketOut(ApiModel):
    id: int
    external_id: str
    provider_kind: str
    connection_id: int | None = None
    title: str
    work_item_type: str = "User Story"
    status: str
    priority: str
    assignee: str = ""
    sprint: str = ""
    area_path: str = ""
    epic: str = ""
    labels: list[str] = Field(default_factory=list)
    ac_count: int = 0


class TicketPageOut(ApiModel):
    """Paged ``GET /tickets`` envelope — ``total`` is computed before limit/offset."""

    items: list[TicketOut] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 25


class TicketDetailOut(TicketOut):
    description: str = ""
    note: str = ""
    acceptance_criteria: list[str] = Field(default_factory=list)
    comments: list[CommentOut] = Field(default_factory=list)
    attachments: list[AttachmentOut] = Field(default_factory=list)
    linked_prs: list[PullRequestOut] = Field(default_factory=list)


class SprintOut(ApiModel):
    id: str
    name: str
    path: str  # ADO iteration path (Project\Sprint) or Jira sprint id
    start_date: str | None = None
    finish_date: str | None = None
    state: str | None = None


class SyncRequest(ApiModel):
    # A work-item connection to sync from (ADR 0006). Falls back to the first
    # connection of ``provider_kind`` when omitted.
    connection_id: int | None = None
    provider_kind: str | None = None
    # Optional project override — when set, the adapter fetches from this project
    # instead of the connection's configured default (Sync dialog Project dropdown).
    project: str | None = None
    mode: str = "sprint"  # sprint | assigned | selected | all
    sprint: str | None = None
    sprint_path: str | None = None
    area_path: str | None = None
    states: list[str] = Field(default_factory=list)
    work_item_types: list[str] = Field(default_factory=list)
    ticket_ids: list[str] = Field(default_factory=list)


class AreaPathOut(ApiModel):
    id: str
    name: str
    path: str


class EpicOut(ApiModel):
    key: str
    name: str


class WorkItemMetadataOut(ApiModel):
    """Filter options for a provider's project (populates the query dropdowns)."""

    area_paths: list[AreaPathOut] = Field(default_factory=list)
    work_item_types: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)
    epics: list[EpicOut] = Field(default_factory=list)


class SyncResult(ApiModel):
    synced: int
    tickets: list[TicketOut] = Field(default_factory=list)


# ---------------------------------------------------------------- Test cases
class TestStep(ApiModel):
    a: str = ""
    e: str = ""


class TestCaseOut(ApiModel):
    id: int
    run_id: int
    ticket_external_id: str
    code: str
    title: str
    objective: str = ""
    precondition: str = ""
    steps: list[TestStep] = Field(default_factory=list)
    test_data: list[dict] = Field(default_factory=list)
    linked_ac: list[str] = Field(default_factory=list)
    priority: str = "Medium"
    test_type: str = "Functional"
    automation: str = "Playwright"
    platform: str = "Web"
    duration: str = "—"
    approval: str = "pending"
    source: str = "ai"
    edited: bool = False


class TestCaseUpdate(ApiModel):
    title: str | None = None
    precondition: str | None = None
    steps: list[TestStep] | None = None
    priority: str | None = None
    test_type: str | None = None
    automation: str | None = None


class TestCaseCreate(ApiModel):
    ticket_external_id: str
    title: str
    precondition: str = ""
    steps: list[TestStep] = Field(default_factory=list)
    priority: str = "Medium"
    test_type: str = "Functional"
    automation: str = "Manual"
    platform: str = "Web"


class ApprovalUpdate(ApiModel):
    approval: str  # approved | rejected | pending


# ---------------------------------------------------------------- Linked test cases
class LinkedTestCaseOut(ApiModel):
    id: int
    ticket_external_id: str
    provider_kind: str
    external_id: str
    title: str
    status: str = "Design"
    url: str = ""
    linked: bool = False
    updated_at: datetime | None = None


class CreateLinkRequest(ApiModel):
    """Create approved test cases in the provider; link them when ``link`` is true.

    ``dry_run`` = local mode: create the LinkedTestCase rows locally with a
    ``LOCAL-`` marker and DO NOT write anything to the provider (avoids polluting a
    live project during local development).
    """

    link: bool = True
    ticket_ids: list[str] = Field(default_factory=list)  # empty = all tickets in the run
    dry_run: bool = False


class LinkTicketResult(ApiModel):
    ticket_external_id: str
    provider_kind: str
    count: int = 0
    created: bool = False
    linked: bool = False
    local: bool = False  # created locally only — provider was not touched
    error: str = ""


class LinkStatusOut(ApiModel):
    status: str = "idle"  # idle | running | done
    results: list[LinkTicketResult] = Field(default_factory=list)


# ---------------------------------------------------------------- Runs
class RunTicketOut(ApiModel):
    ticket_external_id: str
    position: int = 0
    gen_status: str = "queued"
    repo: str = ""
    analysis: dict = Field(default_factory=dict)


class RunRepoOptionOut(ApiModel):
    """A project repo offered as a work item's target, with its knowledge status."""

    name: str
    default: bool = False
    status: str = "not_indexed"


class RunTicketRepoUpdate(ApiModel):
    """Set a work item's target repo ("" resets it to the project default)."""

    repo: str = ""


class RunOut(ApiModel):
    id: int
    code: str
    name: str
    scope: str
    scope_label: str
    framework: str
    browser: str
    env: str
    workers: int
    retry_policy: int
    status: str
    created_at: datetime
    finished_at: datetime | None = None
    cancelled_at: datetime | None = None
    failed_stage: str | None = None
    ticket_ids: list[str] = Field(default_factory=list)
    # Aggregates for the runs list (attached in the router; default 0/None so
    # mutation responses that don't compute them still serialize).
    case_count: int = 0
    total: int = 0  # cases in the latest execution (the "/N" denominator)
    passed: int = 0  # passed in the latest execution
    pass_rate: float | None = None  # 0..100 from the latest report; None until finalized


class RunDetailOut(RunOut):
    run_tickets: list[RunTicketOut] = Field(default_factory=list)


class RunCreate(ApiModel):
    scope: str = "selected"  # single | selected | assigned | sprint
    ticket_ids: list[str] = Field(default_factory=list)
    framework: str = "Playwright"
    browser: str = "chromium"
    env: str = "Staging"
    workers: int = 4
    retry_policy: int = 2
    sprint: str | None = None
    sprint_path: str | None = None


# ---------------------------------------------------------------- Automation
class AutomationSpecOut(ApiModel):
    id: int
    test_case_id: int
    filename: str
    language: str = "TypeScript"
    framework: str = "Playwright"
    code: str = ""
    status: str = "draft"
    block_reason: str = ""
    gate_report: str = ""


class AutomationSpecUpdate(ApiModel):
    """Manual edits to a generated spec's source code (persisted + written to disk)."""

    code: str


# ---------------------------------------------------------------- Execution
class EvidenceOut(ApiModel):
    id: int
    kind: str
    filename: str = ""
    path: str = ""
    size_bytes: int = 0
    annotated: bool = False
    meta: dict = Field(default_factory=dict)


class ExecutionResultOut(ApiModel):
    id: int
    test_case_id: int
    ticket_external_id: str
    case_code: str
    title: str = ""
    status: str
    failure_class: str = ""
    duration_ms: int = 0
    error_message: str = ""
    console_logs: list = Field(default_factory=list)
    network_logs: list = Field(default_factory=list)
    evidence: list[EvidenceOut] = Field(default_factory=list)


class ExecutionOut(ApiModel):
    id: int
    run_id: int
    status: str
    env: str
    browser: str
    workers: int
    total: int
    passed: int
    failed: int
    progress: int
    log: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    results: list[ExecutionResultOut] = Field(default_factory=list)


class ExecutionStart(ApiModel):
    workers: int | None = None
    env: str | None = None


# ---------------------------------------------------------------- Annotation
class AnnotationShape(ApiModel):
    tool: str  # rectangle | arrow | highlight | circle | text
    x: float
    y: float
    w: float = 0
    h: float = 0
    x2: float = 0
    y2: float = 0
    text: str = ""
    color: str = "#f43f5e"


class AnnotateRequest(ApiModel):
    shapes: list[AnnotationShape] = Field(default_factory=list)


# ---------------------------------------------------------------- Reports
class ReportOut(ApiModel):
    id: int
    run_id: int
    execution_id: int | None = None
    overall_result: str
    pass_rate: float
    passed: int
    failed: int
    duration_s: int
    env: str
    data: dict = Field(default_factory=dict)
    created_at: datetime


# ---------------------------------------------------------------- Comments / publish
class TicketCommentOut(ApiModel):
    id: int
    run_id: int
    ticket_external_id: str
    provider_kind: str
    body: str
    status: str
    target_status: str = ""
    external_comment_id: str = ""
    error_message: str = ""


class CommentEdit(ApiModel):
    body: str | None = None
    target_status: str | None = None


class PublishRequest(ApiModel):
    ticket_ids: list[str] = Field(default_factory=list)  # empty = all


# ---------------------------------------------------------------- Settings
class SettingsOut(ApiModel):
    parallel: int = 4
    retry_flaky: bool = True
    screenshot_on_fail: bool = True
    video: bool = False
    max_cases_per_ticket: int = 8
    headless: bool = True
    auto_annotate: bool = True
    neural_background: bool = True
    claude_model: str = "claude-sonnet-5"
    # Per-action model overrides keyed by skill name (#175); {} = defaults/global.
    skill_models: dict[str, str] = Field(default_factory=dict)
    # Ticket concurrency for analyze+generate (#179); 0 = auto (3 Postgres/1 SQLite).
    ai_pipeline_workers: int = 0
    weekly_token_budget: int = 0
    # Default execution target for new runs (Local Agent feature — see
    # EXEC_TARGETS): "server" (legacy in-process runner) or "local-agent"
    # (queued for a paired device to claim).
    execution_target: str = "server"


class SettingsUpdate(ApiModel):
    parallel: int | None = None
    retry_flaky: bool | None = None
    screenshot_on_fail: bool | None = None
    video: bool | None = None
    max_cases_per_ticket: int | None = None
    headless: bool | None = None
    auto_annotate: bool | None = None
    neural_background: bool | None = None
    claude_model: str | None = None
    skill_models: dict[str, str] | None = None
    ai_pipeline_workers: int | None = None
    weekly_token_budget: int | None = None
    execution_target: str | None = None


# ---------------------------------------------------------------- Auth (ADR 0007)
class UserOut(ApiModel):
    """Public shape of a user account (never carries password_hash/totp_secret)."""

    id: int
    email: str
    first_name: str = ""
    last_name: str = ""
    role: str = "member"
    is_active: bool = True
    totp_enabled: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_active: datetime | None = None  # stamped on login/refresh; null if never


class AdminUserOut(UserOut):
    """``UserOut`` plus admin-only fields for the workspace user list."""

    # "personal" (has own credential), "shared" (falls back to the shared
    # credential), or "none" (no Claude credential resolves for this user).
    credential_source: str = "none"


class LoginRequest(ApiModel):
    email: str
    password: str
    remember: bool = False


class LoginResponse(ApiModel):
    """Successful login, or an MFA challenge when totp is enabled.

    On success: ``{accessToken, user}``. When MFA is required:
    ``{mfaRequired: true, mfaToken}`` (and accessToken/user are null).
    """

    access_token: str | None = None
    user: UserOut | None = None
    mfa_required: bool = False
    mfa_token: str | None = None


class MfaLoginRequest(ApiModel):
    mfa_token: str
    code: str


class RefreshResponse(ApiModel):
    access_token: str
    user: UserOut


class RequestResetRequest(ApiModel):
    email: str


class RequestResetResponse(ApiModel):
    """Email delivery is a dev stub — ``token`` is only populated when not in prod."""

    ok: bool = True
    token: str | None = None


class ResetRequest(ApiModel):
    token: str
    password: str


class UpdateMeRequest(ApiModel):
    first_name: str | None = None
    last_name: str | None = None


class ChangePasswordRequest(ApiModel):
    current_password: str
    new_password: str


class TotpSetupResponse(ApiModel):
    secret: str
    otpauth_uri: str


class TotpCodeRequest(ApiModel):
    code: str


class TotpDisableRequest(ApiModel):
    code: str | None = None
    password: str | None = None


class SessionOut(ApiModel):
    id: str
    user_agent: str = ""
    ip: str = ""
    created_at: datetime | None = None
    last_seen_at: datetime | None = None
    expires_at: datetime | None = None
    current: bool = False


class AdminCreateUserRequest(ApiModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    role: str = "member"
    password: str


class AdminUpdateUserRequest(ApiModel):
    role: str | None = None
    is_active: bool | None = None


class AdminInviteUserRequest(ApiModel):
    """Invite a teammate by email — no password; they set one via /auth/reset."""

    email: str
    first_name: str = ""
    last_name: str = ""
    role: str = "member"


class AdminInviteUserResponse(ApiModel):
    """The newly-invited user plus the reset token needed to set a password.

    Mirrors ``RequestResetResponse``: email delivery is a dev stub, so the
    token is only echoed here when not in prod (``cookie_secure`` off).
    """

    user: UserOut
    reset_token: str | None = None


class OkResponse(ApiModel):
    ok: bool = True


# --------------------------------------------------------- Claude credentials (#95)
class ClaudeCredentialsUpload(ApiModel):
    """Body for uploading/replacing a Claude CLI ``.credentials.json``.

    ``credentials`` is the raw file contents (JSON text) — never echoed back.
    """

    credentials: str
    label: str = ""


class ClaudeCredentialModeUpdate(ApiModel):
    """Body for switching the signed-in user's preferred credential mode.

    ``mode`` is ``"own"`` (use my uploaded personal credential) or ``"shared"``
    (prefer the workspace shared account without deleting my upload).
    """

    mode: str


class ClaudeCredentialsMetaOut(ApiModel):
    """Public metadata for one credential row — never the token itself."""

    # "active" | "expired" — "expired" is set when a real CLI call (or the test
    # endpoint) reported the token is no longer usable, so the UI can flag it.
    status: str = "active"
    # Account identity the CLI wrote to <config_dir>/.claude.json after auth —
    # populated once a call has run under the credential.
    account_email: str | None = None
    account_org: str | None = None
    subscription_type: str | None = None
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)
    last_refreshed: datetime | None = None  # the row's updated_at
    # Active users with no own credential (only meaningful for the shared row).
    assigned_users: int | None = None


class ClaudeCredentialsStatusOut(ApiModel):
    """Whether own/shared credentials exist, and which one is effective. Never
    carries the token itself."""

    has_own: bool = False
    has_shared: bool = False
    mode: str = "none"  # "own" | "shared" | "none"
    own: ClaudeCredentialsMetaOut | None = None
    shared: ClaudeCredentialsMetaOut | None = None


class ClaudeCredentialsTestOut(ApiModel):
    """Result of an on-demand credential test (a real minimal Claude call)."""

    ok: bool = False
    # "ok" | "invalid" | "no_credential" | "error"
    result: str = "error"
    message: str = ""
