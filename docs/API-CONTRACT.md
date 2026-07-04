# Q-Agent API Contract

Shared truth for backend (FastAPI) and frontend (TanStack Query) work. All
request/response bodies use **camelCase** on the wire (Pydantic `alias_generator`
= camelCase). Schemas are defined in `api/app/schemas.py`; models in
`api/app/models/`. Base URL default: `http://127.0.0.1:8787`.

## Conventions
- Timestamps: ISO-8601 strings.
- IDs: integer primary keys; `code`/`externalId` are human strings (`RUN-205`, `SUR-1428`, `TC-01`).
- Errors: standard FastAPI `{"detail": "..."}` with appropriate HTTP status.
- No auth in MVP (local-first, single user).

## REST endpoints

### Health
- `GET /health` → `{status, version}`
- `GET /capabilities` → `{claude: bool, version}`

### Providers & Settings  (`api/app/routers/providers.py`)
- `GET /providers` → `ProviderOut[]`
- `GET /providers/{kind}` → `ProviderOut`   (`kind` ∈ ado|jira|github)
- `PUT /providers/{kind}` body `ProviderFieldsIn` → `ProviderOut`  (secrets encrypted at rest)
- `POST /providers/{kind}/test` → `TestConnectionResult`  (live adapter check)
- `GET /providers/{kind}/sprints` → `SprintOut[]`  (ADO iterations / Jira sprints)
- `GET /providers/{kind}/work-item-metadata` → `WorkItemMetadataOut`  (area paths, work-item types, states)
- `GET /settings` → `SettingsOut`
- `PUT /settings` body `SettingsUpdate` → `SettingsOut`

### Projects  (`projects.py`)
- `GET /projects` → `ProjectOut[]`
- `POST /projects/refresh` → `ProjectOut[]`
- `GET /projects/knowledge` → `ProjectKnowledgeOut[]`
- `GET /projects/{key}/knowledge` → `ProjectKnowledgeOut`
- `POST /projects/{key}/knowledge/build` body `KnowledgeBuildRequest` → `ProjectKnowledgeOut`  (project-bootstrap; traverses the configured local repo)
- `GET /projects/{key}/config` → `ProjectConfigOut`  (test accounts masked — no passwords; includes `repos[]`)
- `PUT /projects/{key}/config` body `ProjectConfigUpdate` → `ProjectConfigOut`  (passwords encrypted at rest)
- `GET /projects/{key}/repos/available` → `AvailableReposOut`  (discovered from the provider — ADO/GitHub)
- `GET /projects/{key}/repos` → `RepoKnowledgeOut[]`  (configured repos + per-repo KB status)
- `GET /projects/{key}/repos/{repo}/knowledge` → `ProjectKnowledgeOut`  (one repo's KB)
- `POST /projects/{key}/repos/{repo}/knowledge/build` body `KnowledgeBuildRequest` → `ProjectKnowledgeOut`  (per-repo bootstrap; traverses that repo's checkout)

### Tickets  (`tickets.py`)
- `GET /tickets?status=&assignee=&sprint=&q=` → `TicketOut[]`
- `GET /tickets/{externalId}` → `TicketDetailOut`
- `POST /tickets/sync` body `SyncRequest` → `SyncResult`

### Runs + AI  (`runs.py`)
- `GET /runs` → `RunOut[]`
- `POST /runs` body `RunCreate` → `RunDetailOut`  (starts async analyze+generate pipeline)
- `GET /runs/{runId}` → `RunDetailOut`
- `GET /runs/{runId}/tickets` → `RunTicketOut[]`
- `POST /runs/{runId}/regenerate` → `RunDetailOut`

### Review  (`review.py`)
- `GET /runs/{runId}/cases` → `TestCaseOut[]`
- `POST /runs/{runId}/cases` body `TestCaseCreate` → `TestCaseOut`
- `PATCH /cases/{caseId}` body `TestCaseUpdate` → `TestCaseOut`
- `POST /cases/{caseId}/approval` body `ApprovalUpdate` → `TestCaseOut`
- `POST /cases/{caseId}/regenerate` → `TestCaseOut`
- `POST /runs/{runId}/approve-all` → `TestCaseOut[]`
- `POST /runs/{runId}/tickets/{tid}/approve` → `TestCaseOut[]`

### Create & Link  (`review.py`, `tickets.py`)
- `POST /runs/{runId}/testcases/create-link` body `CreateLinkRequest` → `LinkStatusOut`  (async; creates approved cases in the provider + links them. `dryRun: true` = **local mode**: records cases locally with a `LOCAL-` marker and does **not** write to the provider)
- `GET /runs/{runId}/linked` → `LinkStatusOut`  (per-ticket create/link status; `local` flag when recorded locally)
- `GET /tickets/{externalId}/linked-cases` → `LinkedTestCaseOut[]`

### Automation  (`automation.py`)
- `POST /runs/{runId}/automation/generate` → `AutomationSpecOut[]`  (approved, non-Manual)
- `GET /runs/{runId}/automation` → `AutomationSpecOut[]`
- `GET /cases/{caseId}/spec` → `AutomationSpecOut`
- `POST /cases/{caseId}/spec/regenerate` → `AutomationSpecOut`

### Execution  (`execution.py`)
- `POST /runs/{runId}/execution` body `ExecutionStart` → `ExecutionOut`  (async)
- `GET /runs/{runId}/execution` → `ExecutionOut`  (latest)
- `GET /executions/{executionId}` → `ExecutionOut`

### Evidence  (`evidence.py`)
- `GET /runs/{runId}/evidence` → `{ tickets: EvTicket[], byTicket: { [tid]: ExecutionResultOut[] } }`
- `GET /results/{resultId}/evidence` → `EvidenceOut[]`
- `POST /evidence/{evidenceId}/annotate` body `AnnotateRequest` → `EvidenceOut`
- artifacts served at `GET /artifacts/{path}` (StaticFiles)

### Reports  (`reports.py`)
- `POST /runs/{runId}/report` → `ReportOut`
- `GET /runs/{runId}/report` → `ReportOut`
- `GET /reports` → `ReportOut[]`

### Comments / Publish  (`comments.py`)
- `POST /runs/{runId}/comments/prepare` → `TicketCommentOut[]`
- `GET /runs/{runId}/comments` → `TicketCommentOut[]`
- `PATCH /comments/{commentId}` body `CommentEdit` → `TicketCommentOut`
- `POST /comments/{commentId}/publish` → `TicketCommentOut`
- `POST /runs/{runId}/comments/publish` body `PublishRequest` → `TicketCommentOut[]`
- `POST /runs/{runId}/comments/retry` → `TicketCommentOut[]`

## WebSocket

`WS /ws/runs/{runId}` — server→client progress events. Message shape:
```json
{ "event": "<name>", "runId": "<id>", "payload": { ... } }
```
Event names:
- `analysis.phase` `{ ticket, phase, message }`  — reading / understanding AC / business rules / generating
- `analysis.ticketDone` `{ ticket, caseCount }`
- `run.status` `{ status }`
- `sync.progress` `{ ticket, created, linked, local, error }`  — create & link (or local) per ticket
- `sync.done` `{}`
- `automation.progress` `{ file, message, done, total }`  — `message` is `Generated` / `Regenerated` / `Error: …`
- `exec.case.running` `{ ticket, caseCode, index, total }`
- `exec.case.result` `{ ticket, caseCode, status, durationMs }`
- `exec.progress` `{ progress, passed, failed, remaining }`
- `exec.done` `{ passed, failed }`
- `publish.status` `{ ticket, status }`

Frontend subscribes when viewing a run-scoped screen and merges events into the
relevant TanStack Query caches.
