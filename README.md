# Q-Agent — AI-native QA Operating System

A **local-first, AI-powered QA Operating System**. Q-Agent syncs tickets from
Azure DevOps / Jira, uses the **Claude CLI** to analyze requirements and generate
Azure DevOps-style test cases, lets QA engineers review the AI's work like a pull
request, generates **Playwright** automation, executes it, collects evidence, and
publishes results back to the originating ticket.

Built to feel like Cursor / Linear / Vercel — not a traditional enterprise QA tool:
dark glassmorphism, ambient glow, a live neural background, and an AI that appears
continuously active across the whole pipeline.

> Everything runs locally. No cloud required for the MVP.

## Pipeline

`Sync Tickets → Select → Create Run → Analyze (AI) → Generate Test Cases → Review
→ Generate Playwright → Execute → Collect Evidence → Report → Prepare Comments →
Publish`

The pipeline is visualized on every run-scoped screen and drives the `Run.status`
state machine on the backend.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend (`app/`) | React 19, Vite, TypeScript, Tailwind 4, TanStack Query, Zustand, Framer Motion, Three.js, lucide, sonner, cmdk |
| Backend (`api/`) | FastAPI, SQLAlchemy 2, Pydantic v2, SQLite, httpx, Loguru, Pillow, WebSockets |
| AI engine | Claude CLI (local, invoked via subprocess) |
| Automation | Playwright + TypeScript |
| Providers | Azure DevOps, Jira, GitHub (real REST adapters) |

```
q-agent/
├─ app/          # React frontend
├─ api/          # FastAPI backend (app/, tests/, workspace/ at runtime)
├─ scripts/      # setup.(sh|bat), start.(sh|bat)
├─ design/       # approved UI source (Q-Agent.dc.html) — the fidelity target
├─ docs/         # CLIENT-BRIEF, CONTEXT, API-CONTRACT, ADRs, SUGGEST-TECHSTACK
└─ template/     # test-case export templates (ADO XML, Jira/Xray)
```

## Prerequisites

- **Node 20+** and **npm**
- **[uv](https://docs.astral.sh/uv/)** (Python package manager); Python 3.13 is fetched automatically
- **Claude CLI** — installed and authenticated (`claude`), for real AI analysis/generation
- Playwright browsers (installed by setup)

## Quick start

```bash
# 1. Install everything (backend deps, frontend deps, Playwright browsers)
scripts/setup.sh          # Windows: scripts\setup.bat

# 2. (optional) Load demo data so the UI has content without live providers
cd api && uv run python -m app.seed && cd ..

# 3. Run backend + frontend
scripts/start.sh          # Windows: scripts\start.bat
```

- Frontend: http://localhost:5173
- Backend:  http://127.0.0.1:8787  (OpenAPI docs at `/docs`)

## Configuring live integrations

Open **Settings** in the app (or `PUT /providers/{kind}`) and provide:

- **Azure DevOps** — Organization URL, Project, Personal Access Token (PAT)
- **Jira** — Base URL, Project Key, Email, API Token
- **GitHub** — Organization, Repository, PAT

Credentials are **encrypted at rest** (Fernet key derived from `QAGENT_SECRET_KEY`
in `api/.env` — change it before real use) and are never returned in plaintext.
Use **Test connection** to verify, then **Sync** on the Tickets page.

The Claude CLI must be authenticated (`claude login`) for AI analysis, test-case
generation, spec generation, and comment summaries. Playwright must have browsers
installed (`npx playwright install`) for execution.

## Development

```bash
# Backend
cd api && uv run uvicorn app.main:app --reload --port 8787
cd api && uv run pytest -q          # 78 tests

# Frontend
cd app && npm run dev
cd app && npm run typecheck
cd app && npm run build
```

## Verification status

Verified in this build: backend imports/boots, **78 backend unit tests pass**
(provider adapters via mocked HTTP, AI/automation/execution via mocked engines,
Pillow annotation, publish flows), frontend type-checks and production-builds, and
the UI renders faithfully to the approved design.

Requires the operator's own environment to validate end-to-end (per
[ADR 0001](docs/adr/0001-scope-architecture-and-live-integrations.md)): live
ADO/Jira/GitHub credentials, an authenticated Claude CLI, and installed Playwright
browsers. There is **no mock fallback** — the app talks to the real systems.

## Documentation

- [`docs/CLIENT-BRIEF.md`](docs/CLIENT-BRIEF.md) — product brief
- [`docs/CONTEXT.md`](docs/CONTEXT.md) — glossary & core concepts
- [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) — REST + WebSocket contract
- [`docs/adr/`](docs/adr/) — architecture decisions
