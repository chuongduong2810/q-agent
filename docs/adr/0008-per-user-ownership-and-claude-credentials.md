# ADR 0008 — Per-user data ownership, RBAC, and managed Claude credentials

- **Status:** Accepted
- **Date:** 2026-07-09
- **Deciders:** Operator (in-session), Q-Agent build
- **Extends:** [ADR 0007](0007-application-authentication.md) (authentication)
- **Revises:** [ADR 0006](0006-multiple-provider-connections.md) — provider
  connections become **per-user private** (were team-shared).

## Context

ADR 0007 added authentication (login, JWT + refresh cookie, MFA, a global guard),
but the app still served **one global dataset**: every authenticated user saw and
controlled every other user's runs, projects, and provider connections, and any
member could edit shared provider PATs. Claude ran off the host's single
`claude login`. To make Q-Agent genuinely multi-user we needed data isolation, role
enforcement, and a server-viable Claude auth story — without a cloud deployment
(explicitly out of scope for this batch).

## Decision

### 1. Data is per-user private
Every primary entity carries an `owner_id` FK → `users.id`, and every read is
filtered to the current user. Scoped: `runs`, `tickets`, `projects`,
`project_config`, `provider_connections`, `project_knowledge`, `claude_usage`.
Reusable helpers (`app/services/ownership.py`): `owned(query, model, user)`,
`get_owned_or_404(...)`, `check_owned_or_404(...)`, `stamp_owner(...)`; the current
user comes from `current_user(...)` in `app/deps_auth.py`.

- **Runs** and everything reached through them (executions, reports, evidence,
  comments, test cases) are owner-checked; the `/artifacts` static mount and the
  run WebSocket verify run ownership, not merely a valid token.
- **Provider connections are per-user** — each user holds their own PATs (this
  revises ADR 0006's team-shared model). Credential resolution for sync, repo
  clone, and knowledge build is scoped to the requesting user's connections.

### 2. RBAC + member management
Roles **admin** / **member**. `require_admin` gates the admin plane (member
lifecycle: invite-by-email, role change, deactivate/reactivate, remove — with a
last-active-admin lockout guard). Members have full access to **their own**
resources only, plus self-service (profile, sessions, 2FA, delete own account).

### 3. Claude stays on the CLI, with managed credentials
Rather than an Anthropic API key, Q-Agent manages the CLI's
`~/.claude/.credentials.json` token. Two modes:
1. **Shared account** — an admin uploads/maintains one credential (`owner_id` NULL).
2. **Own account** — a user uploads their personal `.credentials.json`.

Credentials are **Fernet-encrypted at rest** (reusing `app/crypto.py`). Per call,
the effective credential (own → shared → error) is materialized into a per-user
config dir and the subprocess is invoked with `CLAUDE_CONFIG_DIR` pointing at it —
no interactive-login fallback. Cost is attributed per user via
`claude_usage.owner_id`; `/ai/stats` is scoped to the signed-in user.

### 4. Foundation: PostgreSQL + Alembic
Persistence moved to **PostgreSQL** (SQLite retained for local dev + tests) with
real **Alembic** migrations; the startup `create_all` + `_sync_columns` hack is
retired. All ownership columns landed as normal migrations on this baseline.

## The bridge (intentional, not dead code)

`owner_id` is **nullable** and the ownership helpers **no-op when there is no
authenticated user**; an unset `owner_id` is treated as accessible. This keeps the
**auth-disabled local-dev mode** and the existing test suite (which runs with auth
off) working. Enforcing non-null ownership is deferred until/if auth-disabled mode
is retired. New two-user isolation tests run with `auth_required=True` to prove
enforcement when auth is on.

## Consequences

- **Positive:** true per-user isolation across data, credentials, and cost; role
  enforcement; a headless-server-viable Claude auth path that keeps the CLI; a clean
  migration framework for all future schema changes.
- **Cost / risk:** per-user connections mean each user re-enters provider PATs
  (accepted for isolation). The nullable-owner bridge is a deliberate compromise —
  auth-off mode is intentionally permissive; production runs with `QAGENT_AUTH_REQUIRED`
  on (the default). Cross-user protection is only as strong as auth being enabled.

## Not in scope (deferred / excluded)

- **Deferred, blocked on deployment:** execution job queue + worker processes
  (Phase 6), interactive server-side browser sessions via noVNC → WebRTC (§12).
- **Excluded this batch:** containerized deployment (Phase 8 — Docker/Compose/TLS).
- Full multi-tenant (multi-org) isolation; per-project RBAC beyond admin/member.
