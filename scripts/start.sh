#!/usr/bin/env bash
# Start the Q-Agent backend (FastAPI) and frontend (Vite) together.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# If api/.env points at the docker-compose Postgres (127.0.0.1:5456), make
# sure the `db` service is up before the backend starts — uvicorn has no DB
# connection retry, so Alembic's boot-time migration fails immediately
# otherwise. This only starts the plain postgres:16-alpine `db` service, never
# rebuilds the `api`/`web` images.
if grep -q "127.0.0.1:5456" "$ROOT/api/.env" 2>/dev/null; then
  echo "==> Ensuring docker-compose Postgres (db) is up"
  ( cd "$ROOT" && docker compose up -d db ) >/dev/null
  DB_CID="$(cd "$ROOT" && docker compose ps -q db)"
  echo -n "==> Waiting for Postgres..."
  until docker exec "$DB_CID" pg_isready -U qagent -d qagent >/dev/null 2>&1; do
    echo -n "."
    sleep 1
  done
  echo " ready"
fi

echo "==> Backend on http://127.0.0.1:8787"
( cd "$ROOT/api" && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787 ) &

echo "==> Frontend on http://localhost:5173"
( cd "$ROOT/app" && npm run dev ) &

wait
