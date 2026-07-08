# ADR 0006 — Multiple named connections per provider (work-item vs repository)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Operator (in-session), Q-Agent build
- **Extends:** the provider integration model from [ADR 0001](0001-scope-architecture-and-live-integrations.md)
- **Revision:** revised in-session to separate **Work Item** providers from
  **Repository** providers and bind each per project (a project's tickets can come
  from Jira while its code lives on GitHub).

## Context

Today a provider is a **singleton per kind**: `Provider.kind` is `unique=True`
(`api/app/models/provider.py`), so there is exactly one Azure DevOps / Jira /
GitHub configuration. Every consumer resolves credentials with
`db.query(Provider).filter(Provider.kind == <kind>).first()` — ~10 credential
call sites and ~7 project-resolution sites, all keyed by `provider_kind`
**string**. There is no notion of *which account*, and no distinction between
where **work items** come from and where **code repositories** live:

- `repo_service` picks repo credentials by **host-guessing** the URL then grabbing
  that kind's single Provider PAT (`_provider_kind_for_host` + `_pat_for`).
- The repo picker (`projects.py:_provider_for_project_key`) name-matches a
  connected provider by `config.project`.
- Ticket sync auto-derives a provider ("ado preferred, then jira").
- `ProjectConfig` carries **no** provider reference at all.

We need (a) each provider to hold **multiple named connections**, and (b) an
explicit split between **Work Item** providers (Azure DevOps, Jira — the source
of tickets) and **Repository** providers (GitHub — the source of code), bound
**independently per project**.

## Decision

Model a provider as a **kind** in one of two **categories**, grouping **N
`ProviderConnection` rows**. A **project** binds to one work-item connection and
one repository connection (independent). Work-item work routes by ticket origin;
repository work routes by the project's repository connection.

### 0. Provider categories

Code-level classification (no per-kind DB row); each kind keeps its field spec.

| Category | Kinds | Provides | Used by |
|---|---|---|---|
| **work_item** | `ado`, `jira` | tickets / work items | sync, comment publish, work-item linking |
| **repository** | `github` | code repositories | repo clone, knowledge build, repo discovery |

`PROVIDER_CATEGORY: dict[kind → "work_item" | "repository"]` lives in the backend
(and mirrored in the frontend). `category` is surfaced on API payloads so the UI
can render the two groups. (The mock's "Claims Cloud" is illustrative — kinds
stay ado/jira/github.)

### 1. Data model

New table **`provider_connections`** (`api/app/models/provider_connection.py`):

| Column | Type | Notes |
|---|---|---|
| `id` | int pk | connection identity used everywhere |
| `kind` | str(16) index, **not unique** | ado/jira/github |
| `name` | str(120) | connection display name |
| `config` | JSON | non-secret (orgUrl, project, org, repo, baseUrl…) |
| `secrets` | JSON | Fernet-encrypted (reuse `app/crypto.py`) |
| `connected` | bool | last test result |
| `last_sync` / `last_tested_at` | datetime null | |
| `created_at` / `updated_at` | | |

- Retire the legacy `Provider` model for routing; keep it defined only for the
  one-time backfill.
- Add **`Ticket.connection_id`** (nullable FK) — the **work-item** connection a
  ticket was synced from.
- Add to **`ProjectConfig`** two nullable FKs — the per-project bindings (the
  "add setting for project"):
  - **`work_item_connection_id`** — where this project's tickets come from.
  - **`repository_connection_id`** — where this project's code lives.
- `Project.connection_id` (nullable) — the work-item connection that discovered
  the project (set during refresh); optional convenience, not the router.

### 2. Migration & seed (no Alembic — `init_db` `create_all` + `_sync_columns`)

New columns/table auto-apply. Add a best-effort `init_db` backfill (mirroring
`_backfill_audit`): if `provider_connections` is empty and legacy `providers`
rows exist, copy each → one `ProviderConnection`; then, per `ProjectConfig` with
null bindings, set `work_item_connection_id` = first **work_item** connection and
`repository_connection_id` = first **repository** connection (best-effort); stamp
`ticket.connection_id` from the matching work-item connection. Update `seed.py`
to create ≥2 ADO + 1 Jira (work-item) and 1 GitHub (repository) connection, bind
the seeded project to an ADO + the GitHub connection, and stamp tickets.

### 3. Credential resolution — split by category (`connection_service.py`, new)

Two distinct resolution paths, both centralized:

- **Work-item** (ticket fetch, sync, comment publish, work-item linking, project
  key): `resolve_work_item_for_ticket(db, ticket)` → `ticket.connection_id` →
  else first work-item connection of `ticket.provider_kind` → else `ProviderError`.
- **Repository** (repo clone, knowledge build, repo discovery): 
  `resolve_repository_for_project(db, project_key)` → the project's
  `repository_connection_id` → else first repository connection → else error.
- Helpers: `get_connection(id)`, `first_of_kind(kind)`, `connections_by_category(cat)`,
  `adapter_for(db, connection)` (decrypt + `get_adapter`).

Refactor consumers accordingly:

- **Work-item sites** → resolve via the ticket's work-item connection:
  `tickets.py` (comment fetch, provider cases, **sync** — sets `ticket.connection_id`),
  `publish_service` (comment→ticket), `link_service` (adapter cache keyed by
  **connection id**, not kind), `ai_service` (case-offset).
- **Repository sites** → resolve via the project's repository connection:
  `repo_service` (**replace** `_provider_kind_for_host`/`_pat_for` with the
  project's repository connection PAT), `projects.py` repo discovery
  (`_provider_for_project_key` → the project's repository connection),
  `knowledge_service` build.
- **Project-key resolution**: rewrite `resolve_project_key` / `context_for_ticket`
  / `base_url_for` to take a ticket/connection and read the work-item
  `connection.config` directly (removes the fragile `config.project == key`
  guess). Callers: `automation.py`, `runs.py`, `playwright_runner`, `ai_service`,
  `spec_service`, `spec_examples`.

### 4. HTTP API contract

`ConnectionOut = { id, kind, category, name, connected, config, secretFields[], lastSync, lastTestedAt }`.

| Method + path | Behavior |
|---|---|
| `GET /providers` | grouped catalog `[{ kind, category, name, connectionCount, connectedCount, connections: ConnectionOut[] }]` (work-item kinds first, then repository) |
| `POST /providers/{kind}/connections` | `{ name }` → create empty connection |
| `PUT /connections/{id}` | `{ name?, config?, secrets? }` (untouched secrets omitted) |
| `DELETE /connections/{id}` | 204 (null the FKs on tickets/projects/config) |
| `POST /connections/{id}/test` | probe → set `connected`/`last_tested_at` |
| `GET /connections/{id}/sprints` · `/work-item-metadata` | work-item connections |
| `GET /connections/{id}/repos` | repository connections (discovery) |
| `PUT /projects/{key}/config` | `ProjectConfigUpdate` gains **`workItemConnectionId`** + **`repositoryConnectionId`**; `ProjectConfigOut` returns them |
| `POST /tickets/sync` | `SyncRequest` gains **`connectionId`** (a **work-item** connection; fallback to project binding, then first-of-kind) |

Legacy `/providers/{kind}` PUT/test/sprints/metadata are replaced by the
connection-scoped routes.

### 5. Frontend

- **Settings** (`Settings.tsx` + new `ProviderGroup` / `ConnectionRow`; retire
  `ProviderCard`): render under **two category sections** — "Work Item Providers"
  (Azure DevOps, Jira) and "Repository Providers" (GitHub). Each provider is a
  group (icon, name, "N connections · N connected", **+ Add connection**) over
  collapsible connection rows (chevron, name + config-summary/"Not configured",
  status pill, relative time, delete). Expanded = per-kind form (**Connection
  name** + kind fields) + **Test** / **Save** + "Credentials encrypted at rest".
- **Project settings** (`ProjectDetail.tsx` → `ProjectSettingsTab`): add two
  pickers at the top — **Work Item Provider** (choose a work-item connection) and
  **Repository Provider** (choose a repository connection) — saved via
  `ProjectConfigUpdate`. `ReposManager`'s "Discover from …" uses the project's
  repository connection.
- **Sync selector** (`Tickets.tsx`): replace the auto-derived provider with a
  **work-item connection** dropdown, defaulted from the project's bound work-item
  connection; send `connectionId`.
- Types: `ConnectionOut`, `ProviderGroupOut`, `ProviderCategory`. Hooks:
  grouped `useProviders`, `useCreateConnection`, `useUpdateConnection`,
  `useDeleteConnection`, `useTestConnection(id)`, `useConnectionSprints(id)`,
  `useConnectionWorkItemMetadata(id)`, `useConnectionRepos(id)`.

## Consequences

- **Positive:** a project can mix Jira work items + GitHub code; repo credentials
  come from an explicit per-project connection instead of host-guessing;
  `resolve_project_key` simplifies to a direct config read; credential resolution
  is centralized and category-correct.
- **Cost / risk:** wide blast radius across sync, tickets, comments, links, runs,
  projects, repo/knowledge. Nullable FKs + first-of-category fallbacks keep legacy
  rows and any un-bound project working (degrade, never crash). `link_service`'s
  per-kind adapter cache must become per-connection.
- **Not in scope:** new provider kinds; ADO-hosted repos (repos come from the
  repository provider); per-connection RBAC; crypto scheme changes.

## Slicing

Two file-disjoint slices, built in parallel against the contract above:

- **Backend** (`api/`) — categories, `ProviderConnection`, `Ticket.connection_id`
  + `ProjectConfig.{work_item,repository}_connection_id`, backfill + seed,
  `connection_service` (split resolution), refactor work-item + repository +
  project-key consumers, connection CRUD/test/sprints/metadata/repos endpoints,
  project-config connection bindings, `sync` `connectionId`. Gate: `pytest`.
- **Frontend** (`app/`) — Settings two-category provider groups + connection CRUD,
  **project-settings connection pickers**, sync work-item selector, types/hooks.
  Gate: `typecheck` + `build`.

Integration (bind a project to a Jira work-item connection + a GitHub repository
connection; sync a ticket via the work-item connection; confirm repo/knowledge
uses the GitHub connection) is verified after both merge.
