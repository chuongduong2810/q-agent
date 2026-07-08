# Multi-User Server Migration Plan

> **Status:** Draft plan (planning only — no code changes yet)
> **Date:** 2026-07-08
> **Goal:** Move Q-Agent from a *local-first, single-operator* app (every user clones
> the repo and runs it on their own machine) to a **centrally-hosted, multi-user
> server** where access is managed by **logged-in users**, and migrate the database
> from **SQLite → PostgreSQL**.

This is the living plan for that shift. It supersedes the MVP non-goal in
`docs/CONTEXT.md` ("Cloud deployment, multi-user auth/RBAC") — we are now taking on
exactly that. When decisions here are ratified they should be captured as ADRs
(0007+) and this file updated.

---

## 1. What changes conceptually

| | Today (local-first) | Target (server, multi-user) |
|---|---|---|
| Who runs it | Each user runs their own `api/` + `app/` from a clone | One shared deployment; users open a URL and **log in** |
| Identity | None — a free-text `userName` in `settings.json`; audit `actor = "You"` | Real **User** accounts with authenticated sessions |
| Data scope | Everything global to the one process | Every entity **owned/scoped** (see tenancy model, §3) |
| Database | SQLite file in `workspace/q-agent.db`, no migrations | **PostgreSQL** + Alembic migrations |
| Secrets | One shared Fernet key encrypts every PAT; anyone can decrypt anyone's | Owner-scoped connections; key management hardened |
| Claude | Shells out to a locally-authenticated `claude login` CLI | Server-side Anthropic auth + **per-user cost attribution** |
| Playwright | Subprocess on the operator's machine | Isolated execution on server workers (job queue) |
| Filesystem | Single `workspace/` tree, project/run-namespaced | Owner-namespaced storage + access-controlled artifact serving |
| Realtime | In-memory WebSocket hub (one process) | Auth'd WS, external pub/sub if scaled horizontally |
| Delivery | `scripts/setup + start` | Containerized deploy (Docker), reverse proxy, TLS |

---

## 2. Current-state facts this plan is built on

Verified against the codebase (paths are `path:line`):

- **No auth of any kind.** No `Depends`, JWT, session, or WS token; routers mounted
  bare (`api/app/main.py:58`). CORS is permissive localhost (`main.py:46`). Binds
  `127.0.0.1:8787` (`config.py:29`).
- **No user/owner/tenant column anywhere.** Closest is `audit_logs.actor` hardcoded
  to `"You"` (`models/audit.py:32`) and global `userName`/`userRole` in
  `workspace/settings.json` (`services/settings_store.py:22`).
- **SQLite, no Alembic.** Engine at `db.py:14`; schema bootstrapped by `init_db()` +
  hand-rolled `_sync_columns()` `ALTER TABLE` (`db.py:64`, `db.py:103`). Alembic is a
  declared dependency but **no migrations are authored**.
- **Secrets:** one process-wide Fernet key derived from `QAGENT_SECRET_KEY`
  (`crypto.py:20`) encrypts all provider PATs / test-account passwords. Global — any
  user could decrypt any other's credentials.
- **Runs execute in in-process background daemon threads** with an in-memory
  cancellation registry (`services/run_control.py`, ADR 0005). Not restart-safe, not
  multi-instance-safe.
- **Claude CLI** shelled via `subprocess.run([claude, "-p", …])`
  (`services/claude_cli.py:149`) — **relies entirely on the host's `claude login`**;
  no API key passed. Cost recorded to a **global** `claude_usage` ledger.
- **Playwright** runs as a host subprocess against one shared `node_modules` and one
  **process-global** manual-login capture lock (`services/playwright_runner.py`).
  Headed browser capture assumes a single interactive operator.
- **WebSocket hub** is an in-memory `dict[run_id → sockets]` (`ws.py:25`), push-only,
  no auth (`main.py:79`).
- **Workspace filesystem** namespaced by project/run only, never by user
  (`config.py:76`); `/artifacts` static mount serves the whole evidence tree to
  anyone (`main.py:73`).

---

## 3. Open decisions (please confirm — reasonable defaults assumed)

These materially shape the work. This plan assumes the **Recommended** option for
each; correct any and the affected phase adjusts.

| # | Decision | Recommended default (assumed) | Alternative |
|---|---|---|---|
| D1 | **Tenancy model** | **Single organization, many users** (colleagues share one workspace; access gated by role). Simplest fit for an internal QA team. | Full multi-tenant SaaS (isolated orgs) — bigger blast radius; treat as a later extension of the same owner-scoping. |
| D2 | **What is scoped to a user vs shared** | **Projects, provider connections, and their credentials are team-shared** (managed by Admins); **Runs, reviews, evidence, cost are per-user but visible to the team**. Matches how QA teams share ADO/Jira access. | Fully per-user connections (stronger isolation, more setup friction). |
| D3 | **Roles (RBAC)** | Two roles to start: **Admin** (manage users + connections + project config) and **Member** (create/run/review). | Add **Viewer** (read-only) and per-project roles later. |
| D4 | **Auth mechanism** | **Local email+password** with hashed credentials + JWT (access + refresh) *or* httpOnly session cookie. Add **SSO/OIDC** (Microsoft Entra / Google) as a fast-follow since the org likely already has an IdP. | SSO-only from day one (skip local passwords). |
| D5 | **Claude execution on the server** | **Server-side Anthropic API key** (org-billed) via env, with **per-user cost attribution** through the existing `claude_usage` ledger + a new `user_id`. Optionally switch from the CLI to the Anthropic SDK / Claude Agent SDK for cleaner headless auth + concurrency. | Per-user API keys (each user supplies their own key; encrypted per user). |
| D6 | **Run execution model** | Move run workers to a **job queue with worker processes** (e.g. Arq/RQ/Celery + Redis). Restart-safe, multi-instance-safe, replaces the daemon-thread + in-memory registry. | Keep threads but run a **single API instance** (simplest; caps scale + loses restart safety). |
| D7 | **Headed / interactive browser on the server** (manual login + live watch) | **Interactive remote-browser sessions** — run the browser under a virtual display on a worker and stream it to the client with **WebRTC** (watch **and** interact: solve MFA, do manual login, drive the app). See §12. Fallbacks: **noVNC** (simpler interactive) or **upload `storageState.json`** (no streaming). | Watch-only via CDP screencast (cheaper, no interaction); or headed only in local-dev mode. |
| D8 | **Deployment target** | **Self-hosted Docker Compose** on the org's infra (API + Postgres + Redis + worker + reverse proxy/TLS). | Managed cloud (container service + managed Postgres). |

---

## 4. Target architecture (assuming §3 defaults)

```
                 ┌────────────────────────────────────────────┐
   Browser  ──►  │  Reverse proxy (TLS)  →  React app (static) │
   (login)       └──────────────┬─────────────────────────────┘
                                │  Authorization: Bearer <jwt> / cookie
                                ▼
                 ┌──────────────────────────────┐      ┌───────────────┐
                 │  FastAPI (stateless)          │◄────►│  PostgreSQL   │
                 │  - require_user on every route│      └───────────────┘
                 │  - owner-scoped queries       │
                 │  - enqueues run jobs          │      ┌───────────────┐
                 └───────┬───────────────┬───────┘◄────►│  Redis        │
                         │ WS (auth'd)   │ enqueue       │ pub/sub+queue │
                         ▼               ▼               └──────┬────────┘
                 ┌───────────────┐  ┌──────────────────────────▼────────┐
                 │ WS subscribers│  │ Worker process(es)                 │
                 │ (own runs)    │  │ - Claude (server key) + Playwright │
                 └───────────────┘  │ - owner-namespaced workspace       │
                                    └────────────────────────────────────┘
```

Shared object storage (or a mounted volume) holds the owner-namespaced `workspace/`
tree so API and workers see the same artifacts.

---

## 5. Workstreams (the cross-cutting blockers)

Seven blockers, mapped to workstreams. Phases in §6 sequence them.

1. **Identity & auth** — `users` table, password hashing / OIDC, token issuance,
   `require_user` dependency on every router, WS token auth, login UI + guard.
2. **Data ownership scoping** — owner FKs on the entities in D2; owner-filtered
   queries; replace `actor="You"` and global `userName`/`userRole`.
3. **Postgres + Alembic** — swap engine/driver, author a real migration baseline,
   delete `_sync_columns`, per-request sessions, concurrency-safe config.
4. **Secrets isolation** — scope connections to owners; harden key management
   (per-tenant derivation or a KMS/secret manager); lock down decryption paths.
5. **Claude on the server** — server-side Anthropic auth (D5), per-user cost
   attribution, remove the `claude login` host dependency.
6. **Execution & realtime** — job queue + worker processes replacing daemon threads
   (D6); owner-namespaced workspace + access-controlled `/artifacts`; auth'd WS with
   external pub/sub if horizontally scaled; manual-login replacement (D7).
7. **Deployment & ops** — Docker images, Compose stack, config/secrets management,
   TLS/reverse proxy, backups, migration runner, health/readiness.

---

## 6. Phased plan

Follows the repo's slicing methodology (`CLAUDE.md` → *Parallel multi-slice work*):
a **solo foundation**, then **file-disjoint slices in parallel**, then a **solo
cleanup**, with a temporary bridge where a migration can't land green in one step.
Each phase lists its **verify gate** (repo gates: `cd api && uv run pytest -q`;
`cd app && npm run typecheck && npm run build`).

### Phase 0 — Decisions & spec (no code)
- Confirm §3 D1–D8 with stakeholders.
- Write **ADR 0007 (identity, tenancy & RBAC)** and **ADR 0008 (Postgres + job queue
  + deployment)** capturing the ratified choices and the HTTP/auth contract.
- Define the **auth contract** (login/refresh/logout/me endpoints, token shape,
  error codes) and the **ownership matrix** (which table gets which owner FK, D2).
- **Verify:** ADRs reviewed and merged; contract agreed.

### Phase 1 — Foundation: Postgres + Alembic (solo, blocking)
Do the DB move **first** so every later ownership column is a normal migration, not
another `_sync_columns` hack.
- Add `psycopg`/`asyncpg` deps; set `QAGENT_DATABASE_URL` to Postgres; keep SQLite
  supported for local dev if cheap.
- Introduce Alembic properly: author a **baseline migration** matching today's
  schema; delete `_sync_columns()` and the `create_all` bootstrap (`db.py:64`,
  `db.py:103`); run migrations on deploy.
- Verify Postgres-specific types (JSON→`JSONB`, `UTCDateTime`, autoincrement) and
  that background-thread sessions still work under a real connection pool.
- Provide a **one-time data import** path (existing SQLite `workspace/q-agent.db` →
  Postgres) for anyone with local data worth keeping.
- **Verify:** `pytest` green against Postgres (CI service container); app boots and
  serves existing flows against Postgres; baseline migration up/down clean.

### Phase 2 — Foundation: identity core (solo, blocking)
- **Model:** `users` (id, email unique, name, role, password_hash *or* oidc_subject,
  is_active, created_at). Optional `organizations` table if D1 later goes
  multi-tenant (add now as a single default org to avoid a second migration).
- **Auth service:** password hashing (argon2/bcrypt) and/or OIDC; JWT (access +
  refresh) or session cookies; `POST /auth/login`, `/auth/refresh`, `/auth/logout`,
  `GET /auth/me`.
- **`require_user` dependency** + `require_role` for admin routes. Mount globally in
  `main.py` (allow-list only `/health` and `/auth/login`).
- **WS auth:** token (query param or subprotocol) validated in the WS handlers
  (`main.py:79`) before `accept()`.
- **Seed/bootstrap:** create the first Admin from env on empty DB.
- **Bridge:** during rollout, keep a feature flag / default-admin fallback so
  existing single-user flows keep working until scoping (Phase 3) lands.
- **Verify:** `pytest` — unauthenticated request → 401; login issues a token;
  authed request passes; WS rejects tokenless connect.

### Phase 3 — Ownership scoping (parallel-friendly, but touches many files)
Add owner FKs and owner-filtered queries per the D2 matrix. Likely owners:
`runs`, `tickets`, `claude_usage`, `audit_logs` → **per-user** (`created_by`/`owner_id`);
`provider_connections`, `projects`, `project_config` → **team-shared, admin-managed**
(add `created_by` for audit, no per-user filter).
- Migration: add nullable `owner_id`/`created_by` FKs; backfill existing rows to the
  seeded Admin; then enforce non-null where required.
- Rewrite list/detail queries to filter by the current user where D2 says per-user;
  set owner on create; replace `audit_logs.actor="You"` with the real user; drop
  global `userName`/`userRole` from settings in favor of the user profile.
- Split into **file-disjoint slices** by router/service group (runs; tickets;
  cost/audit; connections/projects) run as parallel worktree sub-agents, since they
  touch mostly separate files once the shared migration + `require_user` exist.
- **Verify:** `pytest` — user A cannot read/mutate user B's runs; team-shared
  resources visible to all members; admin-only mutations reject members.

### Phase 4 — Secrets isolation (solo-ish, small surface)
- With connections team-shared (D2), enforce that **only Admins** create/edit/delete
  connections and read decrypted secrets paths; secrets never returned in plaintext
  (already masked — keep it).
- Harden key management: move `QAGENT_SECRET_KEY` into the deployment secret store;
  document rotation. If D2 later goes per-user, switch to per-owner key derivation
  or a KMS envelope scheme.
- Guard the `/artifacts` static mount (`main.py:73`) behind `require_user` + an
  ownership check (evidence belongs to a run's owner) — today it leaks the whole
  tree.
- **Verify:** `pytest` — member cannot hit connection-secret endpoints; artifact URL
  of another user's run → 403; direct-key decryption path is admin-gated.

### Phase 5 — Claude on the server (solo)
- Replace host `claude login` reliance: pass a **server-side Anthropic API key**
  (D5) to the CLI via env, **or** swap `claude_cli.py` to the Anthropic SDK /
  Claude Agent SDK for clean headless auth and better concurrency.
- Add `user_id` to `claude_usage`; attribute each call to the requesting user
  (thread the current user into the ambient run context that
  `ai_usage_service.record` already reads).
- Per-user / per-org **budget & rate limits** (the settings store already has
  `weeklyTokenBudget` — make it per-user and enforce it).
- **Verify:** `pytest` with mocked engine — a run triggered by user X records usage
  under X; missing server key surfaces a clean error (no `claude login` prompt);
  budget exceeded → blocked with a clear message.

### Phase 6 — Execution & realtime for concurrency (solo, larger)
- **Job queue:** move run workers (`ai_service`, `link_service`, `automation`,
  `playwright_runner`, publish) from daemon threads to queued jobs on **worker
  processes** (D6). Replace the in-memory `run_control` registry with a
  **durable** cancel signal (DB flag already exists: `cancel_requested`) + queue
  control; workers honor the terminal-state invariant from ADR 0005.
- **Workspace namespacing:** prefix `workspace/{specs,evidence,knowledge,repos,auth}`
  by owner (or keep project-namespacing if projects are team-shared per D2, but
  ensure the artifact-access check in Phase 4 covers it). Put the tree on shared
  storage/volume so API + workers agree.
- **WS pub/sub:** if running >1 API instance, back `ProgressHub` (`ws.py`) with Redis
  pub/sub so events reach whichever instance holds the client socket.
- **Manual-login capture → interactive browser sessions (§12):** the headed
  single-flight capture (`playwright_runner.py:131`) cannot run as-is on a headless
  multi-user host. Replace it with **WebRTC interactive sessions** — a worker runs
  the browser under a virtual display and streams it to the client to watch *and*
  interact (manual login / MFA). Build the full design in §12 (it can land as its
  own phase after the queue exists).
- **Playwright isolation:** one browser context/profile per job; bounded worker
  concurrency; ensure `node_modules`/browsers are installed in the worker image.
- **Verify:** two users' runs execute concurrently without cross-talk; cancel works
  after an API restart (durable flag); WS events delivered with >1 instance;
  evidence lands under the correct owner namespace.

### Phase 7 — Frontend: login, guard, session, user chip (parallel with 3–6)
- **Auth store** (`app/src/store/auth.ts`, mirroring `store/ui.ts`) for current user
  + tokens, persisted to localStorage.
- **API client:** inject `Authorization` in the single `request()` choke point
  (`lib/api.ts:73`); add a **401 interceptor** (there or via TanStack
  `QueryCache.onError`) → clear session + redirect `/login`; add token to WS URLs
  (`api.ts:112`, `api.ts:263`).
- **Routing:** add a public `/login` route and wrap the authenticated subtree in a
  `RequireAuth` guard modeled on `RunLayout.tsx` (spinner → `<Navigate to="/login">`
  on no session), in `router.tsx:27`.
- **UI:** login screen; real **account menu + logout** replacing the cosmetic
  profile footer (`GlobalSidebar.tsx:111`); admin-only Settings sections (user
  management, connections) gated by role; migrate `userName`/`userRole` into the
  authenticated profile.
- **Verify:** `npm run typecheck && npm run build`; Playwright drive: unauth →
  redirected to `/login`; login → lands in app; logout → session cleared; member
  sees no admin sections.

### Phase 8 — Deployment & ops (solo)
- **Dockerize:** API image (uv), worker image (adds Node + Playwright browsers),
  static frontend build; **Compose** stack: API + worker + Postgres + Redis +
  reverse proxy (TLS).
- Config/secrets via env + secret store (`QAGENT_SECRET_KEY`, DB URL, Anthropic key,
  JWT signing key). CORS locked to the real origin (`main.py:46`).
- **Migration runner** on deploy (Alembic upgrade head); DB backups; health/readiness
  endpoints; structured logs.
- Retire / repurpose `scripts/setup + start` for local dev only; update README +
  `docs/CONTEXT.md` non-goals.
- **Verify:** clean `docker compose up` on a fresh host boots the full stack; a user
  can register/login, connect a provider, run the pipeline end-to-end, and see
  evidence — all over TLS with no local `claude login`.

### Phase 9 — Cleanup (solo)
- Remove bridges/feature flags/default-admin fallback from Phase 2.
- Delete dead single-user code paths (`_sync_columns`, global settings identity
  fields, host-`claude login` messaging).
- Final docs pass: ADRs marked Accepted, README rewritten for the hosted model,
  this plan marked Done.
- **Verify:** full `pytest` + `typecheck` + `build`; end-to-end smoke on staging.

---

## 7. Data model changes (summary)

New:
- `users` (+ optional `organizations` seeded with one default org for future D1).
- `claude_usage.user_id` FK.

Owner/author columns (per D2 matrix, all via Alembic, backfilled to seed Admin):
- Per-user: `runs.owner_id`, `tickets.owner_id` (or org-shared — confirm),
  `audit_logs.actor_user_id` (replaces free-text `actor`).
- Author-only (team-shared): `provider_connections.created_by`,
  `projects.created_by`, `project_config.created_by`.

Retire: `services/settings_store.py` `userName`/`userRole` (→ user profile);
`_sync_columns()` (→ Alembic).

---

## 8. Security checklist (must-haves before exposing beyond localhost)

- [ ] Every route (and both WS endpoints) requires a valid session.
- [ ] CORS restricted to the real frontend origin; `allow_credentials` scoped.
- [ ] `/artifacts` gated by auth + ownership (currently public).
- [ ] Secrets: strong `QAGENT_SECRET_KEY` from a secret store; rotation documented;
      decryption paths role-gated; no plaintext in responses/logs.
- [ ] Passwords hashed (argon2/bcrypt); tokens signed with a strong key; refresh
      rotation + logout invalidation.
- [ ] Rate limiting on `/auth/login`; audit log records the real actor.
- [ ] TLS terminated at the proxy; secure/httpOnly/SameSite cookies if cookie-based.
- [ ] Generated specs bake in **literal credentials** (ADR 0002) — on a shared server
      this is a leak risk; ensure specs live under owner-scoped, access-controlled
      storage and are never served via the public mount.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Claude auth on a headless server** (no `claude login`) | Phase 5: server API key / SDK; fail loudly with a clear message, no interactive prompt. |
| **Thread→queue migration regresses run lifecycle** (ADR 0005 cancel/retry) | Reuse the durable `cancel_requested` flag + terminal-state invariant; port worker checkpoints; test cancel-after-restart. |
| **Headed manual-login incompatible with server** | Phase 6/D7: upload `storageState.json` or headless login; degrade gracefully. |
| **Big blast radius on ownership scoping** | Foundation-first (Phases 1–2) so scoping is normal migrations + a `require_user` already present; slice by disjoint router groups; backfill to seed Admin. |
| **Shared Fernet key exposes all PATs** | Phase 4: role-gate secret access now; per-owner/KMS scheme if D2 → per-user. |
| **Cost blowout with many users** | Phase 5: per-user budgets + rate limits on the shared org key. |
| **Interactive-session CPU/infra cost** (§12: one browser + virtual display + video encoder per session) | Hard cap on concurrent interactive sessions; watch-only viewers use cheap CDP screencast or subscribe to one shared track via an SFU; idle-timeout + TTL teardown; GPU/VAAPI encode if scaled. |
| **Streamed session leaks credentials** (§12 shows real app + typed MFA/passwords) | Owner+admin-only join; single-controller lock; short-lived TURN creds; no recording unless intended; TLS/DTLS-SRTP end to end. |
| **Postgres type/behavior differences** | Phase 1: JSONB, run `pytest` against a real Postgres in CI, verify pool + threaded sessions. |

---

## 10. Out of scope (this iteration)

- Full multi-tenant SaaS isolation (unless D1 changes) — the owner-scoping added here
  is the foundation for it.
- Cypress/Selenium runners; CI/CD pipeline triggers.
- Fine-grained per-project RBAC (beyond Admin/Member).
- Desktop (Tauri) packaging.

---

## 11. Suggested sequencing (dependency waves)

```
Wave A (solo, blocking):   Phase 0 → Phase 1 (Postgres) → Phase 2 (identity core)
Wave B (parallel):         Phase 3 (scoping slices) ‖ Phase 7 (frontend auth)
Wave C (parallel):         Phase 4 (secrets) ‖ Phase 5 (Claude) ‖ Phase 6 (exec/RT)
Wave D (solo):             Phase 8 (deploy) → Phase 9 (cleanup)
```

Pull `master` between waves so each new worktree branches from merged code
(`CLAUDE.md` → *Parallel multi-slice work*).

---

## 12. Interactive browser sessions (WebRTC) — watch + interact (D7)

**Goal:** let a logged-in user **watch a run's browser live and take control**
(complete a manual login, solve MFA, click through the app) even though the browser
runs on a headless server. This replaces the local-only headed capture
(`playwright_runner.py:131`).

### 12.1 Clarifying the premise
- `headless=false` on a Linux server means running the browser under a **virtual
  display (Xvfb)**; there is no physical screen to show.
- **You do not need headed just to *watch***: Chrome DevTools Protocol
  `Page.startScreencast` streams frames even headless (Playwright exposes it via
  `context.newCDPSession(page)`). Cheap, but frame-based and **watch-only**.
- **Interaction** (the chosen requirement) needs a real input path back into the
  browser, so the interactive session runs **headed under Xvfb** and streams via
  WebRTC (or noVNC).

### 12.2 Session model
An **Interactive Browser Session** is a first-class, short-lived resource:
- One session = **one Xvfb display + one headed browser + one media/encode pipeline
  + one signaling channel**, pinned to a worker.
- Bound to a **run** (or a project's manual-login capture) and to its **owner**;
  only the owner + admins may join. **Single-controller lock** — one user drives,
  others watch.
- Lifecycle: `create → join(offer/answer) → interact → close`, with an **idle
  timeout + TTL** and a **hard cap on concurrent sessions** (encoders are the cost).
- On close: tear down browser/Xvfb/encoder/TURN allocation; if it was a login
  capture, persist `storageState.json` (the existing artifact) for reuse.

### 12.3 Media path (server → client)
```
Xvfb display ─► screen capture (GStreamer ximagesrc / FFmpeg x11grab)
             ─► encode (VP8 / H.264)  ─► WebRTC video track ─► client <video>
```
Two implementation options:
- **`aiortc`** (pure-Python, integrates with FastAPI/asyncio). Worker is the WebRTC
  peer. Good for **1 controller + a few watchers** (it opens N peer connections).
- **Media server / SFU** — **LiveKit**, **Janus**, or **mediasoup**. Worker
  publishes **one** track; the SFU fans out to many watchers. Choose this if runs are
  watched by many people. More ops, better scale.

**Recommendation:** start with **aiortc** (no extra server, Python-native); move to an
**SFU** only if watcher fan-out grows.

### 12.4 Input path (client → server)
- Client captures mouse/keyboard → sends over a **WebRTC data channel** (fallback:
  the signaling WS).
- Inject on the server via one of:
  - **CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`** — clean, page-coordinate
    mapped, Playwright-adjacent. *Page content only.*
  - **X-level injection (`xdotool`) into the Xvfb display** — drives the whole
    browser chrome and **native dialogs** (MFA popups, file/permission prompts).
    Preferred for manual-login/MFA where the interaction isn't only page content.

### 12.5 Signaling & connectivity
- New **authenticated** WS endpoint, e.g. `POST /sessions` + `/ws/sessions/{id}/signal`,
  exchanging SDP offer/answer + ICE candidates. Reuse the Phase 2 auth + per-run
  ownership check before `accept()`.
- **ICE:** STUN (public) + a **TURN server (coturn)** — needed in practice for
  clients behind NAT. Issue **short-lived TURN credentials** (coturn REST/HMAC).

### 12.6 Where it slots in the plan
- Depends on **Phase 2** (auth), **Phase 6** (worker/queue so a session runs on a
  worker, not the API), and owner-scoping (**Phase 3**).
- Ship as its own phase (**Phase 6.5 — Interactive sessions**) after the queue lands.
- **Frontend (Phase 7):** a "Watch / Take control" affordance on the Execution and
  manual-login screens; a `<video>` + input-capture surface; a controller-lock
  indicator. WebRTC/ICE wiring lives alongside the run socket.

### 12.7 Effort & fallbacks (ranked)
1. **Watch-only** (if requirement ever relaxes): CDP screencast over the existing WS
   — smallest, no Xvfb/TURN. *(Not sufficient for "interact".)*
2. **noVNC** (Xvfb + `x11vnc` + `websockify`): full interaction, battle-tested,
   fastest to stand up; higher latency than WebRTC. **Good pragmatic first delivery.**
3. **WebRTC** (this section): best latency/quality, most infra (TURN + encoders +
   per-session CPU). Best for a polished interactive experience.

**Suggested path:** land **noVNC** first to unblock server-side manual login quickly,
then upgrade the interactive session to **WebRTC** if latency/quality warrants —
both share the Xvfb-headed-browser-on-a-worker foundation, so the second is an
incremental swap of the transport, not a rebuild.
