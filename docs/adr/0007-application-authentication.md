# ADR 0007 — Application authentication: email+password, JWT + refresh-cookie sessions, RBAC

- **Status:** Proposed
- **Date:** 2026-07-09
- **Deciders:** Operator (in-session), Q-Agent build
- **Implements:** Phase 2 (identity core) + Phase 7 (frontend auth) of
  [`docs/MULTI-USER-MIGRATION-PLAN.md`](../MULTI-USER-MIGRATION-PLAN.md)
- **Defers (out of scope here):** SSO/OIDC (plan D4 fast-follow), Postgres + Alembic
  (plan Phase 1), and per-entity ownership scoping (plan Phase 3). See §Deferred.

## Context

Q-Agent has **no application authentication of any kind** — routers are mounted bare
(`api/app/main.py:58`), the two WebSocket endpoints accept tokenless
(`main.py:79`, `:89`), `/artifacts` is a public static mount (`main.py:73`), and the
only notion of "who" is a free-text `userName`/`userRole` in `workspace/settings.json`
(`services/settings_store.py:21-22`) plus an `audit_logs.actor` hardcoded to `"You"`
(`models/audit.py:32`). The frontend is greenfield: no login route, no auth store, no
`Authorization` header, no 401 handling.

The design (`design/Q-Agent app design_auth_splash/Q-Agent Auth.dc.html`) specifies five
states — **login, signup, forgot, signed-out, profile** — plus a full-screen redirect
loader. We are shipping the **username/password vertical first** and **hiding the SSO
providers** (Microsoft/Google/GitHub) shown in the mock.

This ADR is a **scoped subset** of the migration plan, deliberately taken **before** the
Postgres move: the `users`/`sessions` tables are purely *additive* (SQLite `create_all`
+ `_sync_columns` at `db.py:69`/`:103` create them with zero migration work), and we add
**no** owner columns to existing entities, so nothing here blocks or is blocked by the DB
migration. When Postgres lands (plan Phase 1) these tables fold into the Alembic baseline.

## Decision

Adopt **local email+password authentication** with **short-lived access JWTs (in memory)**
and **long-lived refresh tokens in an httpOnly cookie**, backed by a server-side
**`sessions`** table. Two roles — **Admin** and **Member**. Accounts are
**admin-provisioned** (no public self-signup). Enforcement is **feature-flagged** during
rollout and flipped on in cleanup.

### Identity model (new tables — no Alembic needed)

**`users`** (`api/app/models/user.py`):
`id` (int pk), `email` (str, unique, lowercased), `first_name`, `last_name`,
`role` (`"admin" | "member"`, default `"member"`), `password_hash` (str),
`is_active` (bool, default true), `totp_secret` (str, nullable — 2FA),
`totp_enabled` (bool, default false), `created_at`, `updated_at`.

**`sessions`** (refresh-token / active-session tracking):
`id` (uuid/str pk — the refresh-token identifier), `user_id` (fk),
`refresh_token_hash` (str — argon2/sha256 of the opaque refresh token, never stored raw),
`user_agent` (str), `ip` (str), `created_at`, `last_seen_at`, `expires_at`,
`revoked_at` (nullable). One row per active login; powers refresh rotation **and** the
profile "Active sessions" list + revoke.

Import both in `models/__init__.py` (order after providers/projects); `init_db()`
creates them.

### Password hashing & tokens

- **Hashing:** `argon2-cffi` (add to `pyproject.toml`). New service `services/auth_service.py`.
- **Access token:** JWT (`pyjwt`), HS256 signed with `settings.secret_key`
  (`config.py:39`), `exp` ≈ **15 min**, claims `{sub: user_id, role, sid: session_id}`.
  Returned in the login/refresh **response body**; the SPA holds it **in memory only**.
- **Refresh token:** opaque random string, **~30 days**, sent as a
  `Set-Cookie: qagent_refresh=…; HttpOnly; Secure; SameSite=Lax; Path=/auth`. Its hash +
  metadata live in a `sessions` row. Refresh **rotates** the token (new value, same or
  new `sid`; old value invalidated). "Keep me signed in for 30 days" (design) toggles
  refresh lifetime / cookie `Max-Age`.
- **CSRF:** because the refresh cookie is sent automatically, `/auth/refresh` and any
  cookie-authenticated mutation use **double-submit**: a non-httpOnly `qagent_csrf` cookie
  mirrored in an `X-CSRF-Token` header, compared server-side. Access-token (bearer) calls
  are not CSRF-exposed.

### Auth contract (all endpoints implemented in Issue 1)

Public (allowlisted):
- `POST /auth/login` → body `{email, password, remember}`; on success sets refresh +
  csrf cookies, returns `{accessToken, user}`. If the user has 2FA enabled, returns
  `{mfaRequired: true, mfaToken}` and the client posts `POST /auth/login/mfa`
  `{mfaToken, code}`.
- `POST /auth/refresh` → reads refresh cookie + CSRF header; rotates; returns
  `{accessToken, user}`. Used on app boot to restore a session.
- `POST /auth/request-reset` / `POST /auth/reset` → email→**dev-log stub** (no mailer
  yet): `request-reset` logs/returns the reset token in dev; `reset` `{token, password}`.
- `GET /health` (already public).

Authenticated (require access token via `Authorization: Bearer`):
- `GET /auth/me` → current `user`.
- `PATCH /auth/me` → `{firstName?, lastName?}` (email/role are **read-only** to members —
  "managed by admin").
- `POST /auth/change-password` → `{currentPassword, newPassword}`.
- `POST /auth/logout` → revokes current session, clears cookies.
- **2FA:** `POST /auth/2fa/setup` (returns otpauth URI/secret), `POST /auth/2fa/enable`
  `{code}`, `POST /auth/2fa/disable` `{code|password}`.
- **Sessions:** `GET /auth/sessions` (list, current flagged), `DELETE /auth/sessions/{id}`,
  `POST /auth/sessions/revoke-others`.
- **Delete account:** `DELETE /auth/me` (cascade the user's data; confirm-gated in UI).

Admin only (`require_role("admin")`):
- `GET /auth/users`, `POST /auth/users` (create — replaces public signup:
  `{email, firstName, lastName, role, password|invite}`), `PATCH /auth/users/{id}`
  (role / active), `DELETE /auth/users/{id}`.

Schemas live in `app/schemas.py` extending `ApiModel` (camelCase wire aliases). Login /
logout / password-change / user-CRUD write `audit_service.record(category="auth", …)`
(the `"auth"` category already exists — `audit.py:20`).

### Guard, allowlist & rollout flag

- New dependency `require_user` (validates the bearer access token → loads the active
  user) and `require_role(role)`. A **global** guard is installed in `main.py` that
  enforces `require_user` on every route **except** an allowlist:
  `/health`, `/auth/login`, `/auth/login/mfa`, `/auth/refresh`, `/auth/request-reset`,
  `/auth/reset`, and (temporarily) the docs.
- Enforcement is gated by a new setting **`QAGENT_AUTH_REQUIRED`** (`config.py`, default
  **false**). It stays **off** through Waves A–B so existing local dev keeps working, and
  is flipped **true** in Wave C once the login UI ships.
- `/artifacts` static mount (`main.py:73`) and the WS endpoints (`main.py:79`, `:89`) are
  guarded via **middleware / query-token** (mounts + WS bypass router deps). WS clients
  pass the access token as `?token=`; middleware validates before `accept()`. (Ownership
  checks on artifacts are Phase 3 — for now, guard = "must be authenticated".)

### Bootstrap

First **Admin** is seeded on empty DB from `QAGENT_ADMIN_EMAIL` / `QAGENT_ADMIN_PASSWORD`
(env, `config.py` + `lifespan` at `main.py:33`). Documented in `.env.example`.

### Frontend contract

- **`app/src/store/auth.ts`** (Zustand): holds `user` + `accessToken` **in memory** (not
  persisted — the refresh cookie is the durable credential). Actions: `login`, `logout`,
  `setSession`, `bootstrap` (calls `/auth/refresh`).
- **`app/src/lib/api.ts`**: the single `request()` choke point (`api.ts:74`) adds
  `credentials: "include"`, injects `Authorization: Bearer <accessToken>` and the
  `X-CSRF-Token` header; on **401** it calls `/auth/refresh` **once**, retries, and on
  failure clears the store + redirects to `/login`. WS URL builders (`api.ts:113`,
  `:264`) append `?token=`.
- **Dev cross-origin:** the SPA (`5173`) and API (`8787`) are cross-site, so cookies won't
  flow. Add a **Vite dev proxy** routing `/auth`, `/api`-equivalent paths, and `/ws` to
  `127.0.0.1:8787` so app + API are same-origin in dev. (Prod: reverse proxy, same origin.)
- **Routing** (`router.tsx`): public `/login`, `/forgot`, `/signed-out`, `/profile`, and
  admin `/settings/users`; the authenticated subtree is wrapped in a **`RequireAuth`**
  layout element modeled on `RunLayout` (`screens/RunLayout.tsx:13-35`) — it runs
  `bootstrap()` (spinner → redirect loader), redirects to `/login` when unauthenticated,
  else renders `<Outlet/>`. **No public `/signup`.**
- **Shell:** the cosmetic sidebar footer (`GlobalSidebar.tsx:111-137`) becomes a real
  account menu + logout; identity is read from `/auth/me`, not `settings.json`.

## Consequences

- Every request/WS becomes authenticated once the flag flips; `/artifacts` no longer
  public. Local single-operator dev must now log in (seeded admin) after Wave C.
- `settings.json` `userName`/`userRole` are superseded by the user profile (retired in
  cleanup); `audit_logs.actor` becomes the real user.
- A `sessions` table introduces server-side session state (revocation, active-sessions
  UI) — the tradeoff for httpOnly-cookie security over stateless-JWT simplicity.
- SSO, Postgres, and ownership scoping remain follow-on epics; this ADR is the foundation
  they build on.

## Deferred

- **SSO/OIDC** (Microsoft Entra / Google / GitHub) — buttons hidden in the UI now; wire
  later (plan D4).
- **Postgres + Alembic** (plan Phase 1) — these tables migrate into the baseline then.
- **Per-entity ownership scoping** (`owner_id` on runs/tickets/…, plan Phase 3) — next
  epic; artifact/ WS guards here are "authenticated", not yet "owner-scoped".
