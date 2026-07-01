#!/usr/bin/env bash
# Q-Agent one-click setup (macOS/Linux). Installs backend + frontend deps and
# Playwright browsers. Requires: uv, node 20+, and the Claude CLI (`claude`).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend (api): uv sync"
( cd "$ROOT/api" && uv sync --extra dev )

echo "==> Frontend (app): npm install"
( cd "$ROOT/app" && npm install )

echo "==> Playwright browsers (chromium)"
( cd "$ROOT/app" && npx playwright install chromium )

if [ ! -f "$ROOT/api/.env" ]; then
  cp "$ROOT/api/.env.example" "$ROOT/api/.env"
  echo "==> Created api/.env from example (edit QAGENT_SECRET_KEY before real use)"
fi

echo ""
echo "Setup complete."
echo "  • Configure providers + authenticate the Claude CLI (\`claude\`)."
echo "  • Optional demo data:  cd api && uv run python -m app.seed"
echo "  • Start everything:    scripts/start.sh"
