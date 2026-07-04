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
class ProviderFieldsIn(ApiModel):
    """Non-secret + secret provider fields submitted by the Settings screen."""

    config: dict[str, str] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)  # plaintext in, encrypted at rest


class ProviderOut(ApiModel):
    id: int
    kind: str
    name: str
    connected: bool
    config: dict = Field(default_factory=dict)
    # secrets are returned masked only (has_<field> booleans), never plaintext
    secret_fields: list[str] = Field(default_factory=list)
    last_sync: datetime | None = None


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
    title: str
    work_item_type: str = "User Story"
    status: str
    priority: str
    assignee: str = ""
    sprint: str = ""
    area_path: str = ""
    labels: list[str] = Field(default_factory=list)
    ac_count: int = 0


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
    provider_kind: str
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


class WorkItemMetadataOut(ApiModel):
    """Filter options for a provider's project (populates the query dropdowns)."""

    area_paths: list[AreaPathOut] = Field(default_factory=list)
    work_item_types: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)


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
    precondition: str = ""
    steps: list[TestStep] = Field(default_factory=list)
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
    ticket_ids: list[str] = Field(default_factory=list)


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
    user_name: str = ""
    user_role: str = ""
    auto_annotate: bool = True
    neural_background: bool = True


class SettingsUpdate(ApiModel):
    parallel: int | None = None
    retry_flaky: bool | None = None
    screenshot_on_fail: bool | None = None
    video: bool | None = None
    max_cases_per_ticket: int | None = None
    headless: bool | None = None
    user_name: str | None = None
    user_role: str | None = None
    auto_annotate: bool | None = None
    neural_background: bool | None = None
