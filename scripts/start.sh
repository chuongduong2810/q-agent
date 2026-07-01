#!/usr/bin/env bash
# Start the Q-Agent backend (FastAPI) and frontend (Vite) together.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Backend on http://127.0.0.1:8787"
( cd "$ROOT/api" && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787 ) &

echo "==> Frontend on http://localhost:5173"
( cd "$ROOT/app" && npm run dev ) &

wait
