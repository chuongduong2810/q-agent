# syntax=docker/dockerfile:1

# Q-Agent backend (FastAPI).
#
# Bakes in Python 3.13 + uv, the Node 20 runtime + the Claude Code CLI (AI runs
# server-side; auth comes from in-app uploaded credentials, not the host), and
# git (project-bootstrap clones application repos). It deliberately ships NO
# Playwright/chromium — test execution is offloaded to the paired Local Agent
# (set Execution target = Local Agent in the app).
#
# Build context is the REPO ROOT (see docker-compose.yml) so it can also copy
# the dedicated `skills/` the backend injects as Claude system prompts.
FROM python:3.13-slim-bookworm

# uv (pinned to match the uv.lock format, revision 3) — fast, reproducible
# installs straight from api/uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.11.13 /uv /uvx /usr/local/bin/

# Node 20 runtime copied from the official image (the Claude Code CLI is a Node
# package), plus git + ca-certificates for repo cloning and outbound HTTPS.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force

ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/api/.venv \
    PATH="/app/api/.venv/bin:${PATH}"

WORKDIR /app/api

# Install Python deps first so this layer is cached until the lockfile changes.
# `[tool.uv] package = false` means only dependencies are installed (no project
# build), so the lock files alone are enough here.
COPY api/pyproject.toml api/uv.lock ./
RUN uv sync --frozen --no-dev

# Backend source (includes alembic.ini + migrations/, applied at boot) and the
# dedicated Q-Agent skills. api/.dockerignore keeps .venv/workspace/.env out.
COPY api/ ./
COPY skills/ /app/skills/

# Bind on all interfaces so the web (nginx) container can reach the API. Secrets,
# auth flags and the admin seed are supplied via the environment (compose).
ENV QAGENT_HOST=0.0.0.0 \
    QAGENT_PORT=8787

EXPOSE 8787
# `python -m uvicorn` puts the working dir on sys.path so `app.main` imports.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
