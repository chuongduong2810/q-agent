# Running Q-Agent with Docker

The stack builds into three containers behind one public port, so a single
Cloudflare tunnel still fronts everything (just like the Vite dev proxy):

| Service | Image | Port | Role |
|---------|-------|------|------|
| `web`   | nginx serving the built SPA | **5174** (published) | Serves the SPA; reverse-proxies same-origin `/api`, `/auth` and websockets to `api`. |
| `api`   | FastAPI + Python 3.13/uv + Node + Claude CLI + git | 8787 (internal) | REST + WebSocket backend. AI runs here via the Claude CLI. |
| `db`    | postgres:16-alpine | **5456** (published) → 5432 | PostgreSQL database. Reachable from the host (DBeaver/psql) at `localhost:5456`; override with `QAGENT_DB_PORT`. |

The `api` image ships **no Playwright/chromium** — test execution is offloaded
to the paired **Local Agent**. AI runs server-side and authenticates with the
Claude credentials you upload in the app (no `~/.claude` mount needed).

## Quick start

```bash
cp .env.example .env          # then edit: set QAGENT_SECRET_KEY + admin password
docker compose up -d --build
```

Open <http://localhost:5174> (or point your Cloudflare tunnel at `:5174`).

## First-run setup (in the app)

1. Sign in with `QAGENT_ADMIN_EMAIL` / `QAGENT_ADMIN_PASSWORD` from your `.env`.
2. **Settings → AI** — upload your Claude `.credentials.json`
   (`~/.claude/.credentials.json` on a machine where `claude` is logged in).
   This is what authenticates all server-side AI actions.
3. **Settings** — set **Execution target = Local Agent**, then pair a Local
   Agent (Settings issues a pairing code). Because this image has no Playwright,
   choosing server-side execution will fail — runs must target the Local Agent.
4. Configure providers (Azure DevOps / Jira / GitHub) and per-project setup as
   usual — see the main [README](../README.md).

## Data & persistence

State lives in two named volumes, both surviving `docker compose down` (remove
them with `docker compose down -v`):

- **`qagent-db`** — the PostgreSQL data directory (all relational data).
- **`qagent-workspace`** (`/app/api/workspace`) — evidence, generated specs,
  per-repo knowledge, cloned repos, and the materialized Claude credentials.

The `api` waits for `db` to pass its health check, then Alembic applies the
schema to Postgres automatically on boot (`QAGENT_DATABASE_URL` in
`docker-compose.yml`, assembled from `QAGENT_DB_*` in `.env`). The database is
published on host port `5456` (override with `QAGENT_DB_PORT`) so you can
inspect it with DBeaver/psql at `localhost:5456` (user/password/db from
`QAGENT_DB_*`, default `qagent`/`qagent`/`qagent`).

To use an **external** Postgres instead of the bundled one, set
`QAGENT_DATABASE_URL` directly on `api` (e.g.
`postgresql+psycopg://user:pass@host.docker.internal:5455/dev_qagent`) and drop
the `db` service. To fall back to **SQLite**, remove `QAGENT_DATABASE_URL` — the
DB then lives in the `qagent-workspace` volume.

## Common commands

```bash
docker compose logs -f api        # follow backend logs
docker compose up -d --build      # rebuild + restart after code changes
docker compose down               # stop (keeps the workspace volume)
docker compose down -v            # stop and delete all data
```

## Notes

- `QAGENT_COOKIE_SECURE` defaults to `false`, which works both on plain-http
  localhost and behind an HTTPS Cloudflare tunnel. Set it to `true` for a
  strict HTTPS-only deployment (then admin creds become mandatory — they're
  already set from `.env`).
- The nginx `/api` location uses a 30-minute proxy timeout so long AI calls
  (analysis, project-bootstrap) don't hit a 504.
