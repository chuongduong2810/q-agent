# ADR 0006 — Multiple named connections per provider

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Operator (in-session), Q-Agent build
- **Extends:** the provider integration model from [ADR 0001](0001-scope-architecture-and-live-integrations.md)

## Context

Today a provider is a **singleton per kind**: `Provider.kind` is `unique=True`
(`api/app/models/provider.py`), so there is exactly one Azure DevOps / Jira /
GitHub configuration. Every consumer resolves credentials with
`db.query(Provider).filter(Provider.kind == <kind>).first()` — ~10 credential
call sites (adapter construction) and ~7 project-resolution sites, all keyed by
`provider_kind` **string**. Tickets, comments, linked cases, runs, and projects
reference a provider only by `provider_kind` — there is no notion of *which
account*. `project_config_service.resolve_project_key` is the chokepoint: it
maps a kind → the single provider row → its one `config.project` → a project.

We need to let each provider hold **multiple named connections** (e.g. two Azure
DevOps orgs), managed in Settings (add / edit / test / save / delete), per the
new design.

## Decision

Model a provider as a **kind** (a fixed catalog: `ado`, `jira`, `github`) that
groups **N `ProviderConnection` rows**. **Route by origin:** each ticket (and
project) records the connection it came from, and every downstream flow resolves
credentials via that connection. (Operator decision — chosen over a
"primary-per-kind" shortcut so multiple accounts of the same kind are genuinely
usable.)

### 1. Data model

New table **`provider_connections`** (`api/app/models/provider_connection.py`):

| Column | Type | Notes |
|---|---|---|
| `id` | int pk | connection identity used everywhere |
| `kind` | str(16) index, **not unique** | `ado`/`jira`/`github` |
| `name` | str(120) | connection display name ("Surency — Mobile") |
| `config` | JSON | non-secret (orgUrl, project, org, repo, baseUrl…) |
| `secrets` | JSON | Fernet-encrypted values (reuse `app/crypto.py`) |
| `connected` | bool | last test result |
| `last_sync` | datetime null | |
| `last_tested_at` | datetime null | |
| `created_at`/`updated_at` | | |

- The legacy `Provider` model/table is **retired for routing** but kept defined
  so the one-time backfill can read it; new DBs simply won't populate it.
- Add **`Ticket.connection_id`** (nullable FK → `provider_connections.id`) — the
  connection a ticket was synced from. Add **`Project.connection_id`** likewise,
  set during projects refresh.
- Provider **kind catalog** (display name, icon, field spec) stays in code /
  frontend — no DB row per kind.

### 2. Migration & seed (no Alembic — `init_db` runs `create_all` + `_sync_columns`)

- New columns/table appear automatically. Add a best-effort `init_db` backfill
  (mirroring `_backfill_audit`): if `provider_connections` is empty and legacy
  `providers` rows exist, copy each `Provider` → one `ProviderConnection`
  (`name = Provider.name`, same kind/config/secrets/connected/last_sync); then
  set `ticket.connection_id`/`project.connection_id` to the migrated connection
  of the matching kind where null.
- Update `seed.py` to create connections directly (e.g. ADO "Surency — Mobile"
  connected + a second ADO connection, one Jira, one GitHub) and stamp seeded
  tickets/projects with their connection id.

### 3. Credential resolution (`api/app/services/connection_service.py`, new)

Single source of truth; **all consumers go through it**:

```python
def resolve_for_ticket(db, ticket) -> ProviderConnection: ...
    # ticket.connection_id if set, else first connection of ticket.provider_kind
    # (backward-compat fallback), else raise ProviderError.
def get_connection(db, connection_id) -> ProviderConnection | None: ...
def first_of_kind(db, kind) -> ProviderConnection | None: ...
def adapter_for(db, connection) -> ProviderAdapter:  # decrypt secrets + get_adapter(kind, config, secrets)
```

Refactor **every** call site (the concrete list to change):

- Credential sites → build the adapter from a resolved connection:
  `tickets.py` (comment fetch, provider cases, **sync**), `projects.py` (refresh
  loops **all connections**; repos picker), `publish_service` (via the comment's
  ticket), `link_service` (`_adapter_for` now keyed by **connection id**, not
  kind — the per-kind cache must become per-connection), `ai_service`
  (case-offset), `repo_service` (`_pat_for` — pick the connection whose host
  matches), and the connection test/sprints/metadata endpoints (explicit id).
- Project-resolution sites → resolve the connection for the ticket, then read
  `connection.config`: rewrite `resolve_project_key` /
  `context_for_ticket` / `base_url_for` to take a ticket (or connection) and use
  `connection.config.project` **directly** (this removes the fragile
  `config.project == ProjectConfig.key` guessing). Call sites: `automation.py`,
  `runs.py` (`_resolve_run_project_key`), `playwright_runner`, `ai_service`,
  `spec_service`, `spec_examples`.

### 4. HTTP API contract (both slices target this)

`ConnectionOut = { id, kind, name, connected, config, secretFields[], lastSync, lastTestedAt }`
(secrets never serialized — only masked field names, as today).

| Method + path | Behavior |
|---|---|
| `GET /providers` | grouped catalog: `[{ kind, name, connectionCount, connectedCount, connections: ConnectionOut[] }]` (fixed kind order ado, jira, github) |
| `POST /providers/{kind}/connections` | body `{ name }` → create an empty connection → `ConnectionOut` (201) |
| `PUT /connections/{id}` | body `{ name?, config?, secrets? }` (untouched secrets omitted) → `ConnectionOut` |
| `DELETE /connections/{id}` | 204 (cascade/null `connection_id` on tickets/projects) |
| `POST /connections/{id}/test` | probe + set `connected`/`last_tested_at` → `TestConnectionResult` |
| `GET /connections/{id}/sprints` | `SprintOut[]` |
| `GET /connections/{id}/work-item-metadata` | `WorkItemMetadataOut` |
| `POST /tickets/sync` | `SyncRequest` gains **`connectionId`** (required going forward; if absent, falls back to first connection of `providerKind`). Sets `ticket.connection_id` on import. |

The legacy `/providers/{kind}` PUT/test and `/providers/{kind}/sprints|work-item-metadata`
are replaced by the connection-scoped routes above.

### 5. Frontend

- **Settings** (`Settings.tsx` + new `ProviderGroup` / `ConnectionRow` components,
  retiring the single-card `ProviderCard`): render the fixed kind catalog; each
  provider is a group header (icon, name, "N connections · N connected",
  **+ Add connection**) over a list of collapsible connection rows (chevron,
  name + config-summary / "Not configured", status pill, relative time, delete).
  Expanded row = per-kind form (**Connection name** + kind fields) with
  **Test connection** / **Save connection** and "Credentials encrypted at rest".
- **Sync selection** (route-by-origin): wherever tickets are synced/imported
  today by picking a `providerKind`, pick a **connection** instead (a connection
  dropdown grouped by provider) and send `connectionId`.
- Types: `ConnectionOut`, `ProviderGroupOut`. Hooks: `useProviders` (grouped),
  `useCreateConnection`, `useUpdateConnection`, `useDeleteConnection`,
  `useTestConnection(id)`, `useConnectionSprints(id)`, `useConnectionWorkItemMetadata(id)`.
  API client: connection-scoped methods above.

## Consequences

- **Positive:** true multi-account support; `resolve_project_key` gets *simpler*
  (direct `connection.config.project`, no guessing); credential resolution is
  centralized in one service instead of ~17 ad-hoc `Provider.kind==…` lookups.
- **Cost / risk:** wide blast radius — one connection reference threaded through
  sync + tickets + comments + links + runs + projects. The nullable
  `connection_id` + first-of-kind fallback keeps legacy rows and any missed path
  working (degrades to "first connection", never crashes). `link_service`'s
  per-kind adapter cache must become per-connection or it will reuse the wrong
  credentials.
- **Not in scope:** new provider kinds (the mock's "Claims Cloud" is illustrative
  — kinds stay ado/jira/github); per-connection RBAC; changing the crypto scheme.

## Slicing

Two file-disjoint slices, built in parallel against the contract above:

- **Backend** (`api/`) — `ProviderConnection` model + `Ticket/Project.connection_id`,
  `init_db` backfill + seed, `connection_service`, refactor all credential +
  project-resolution consumers, connection CRUD/test/sprints/metadata endpoints,
  `sync` accepts `connectionId`. Gate: `pytest`.
- **Frontend** (`app/`) — Settings provider-groups + connection CRUD forms, sync
  connection selector, types/hooks/client. Gate: `typecheck` + `build`.

Integration (create → test → save → sync a ticket via a specific connection →
confirm downstream uses it) is verified after both merge.
