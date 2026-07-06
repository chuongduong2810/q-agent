#!/usr/bin/env bash
# Q-Agent one-click setup (macOS/Linux). Installs backend + frontend deps and
# Playwright browsers. Requires: uv, node 20+, and the Claude CLI (`claude`).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "==> uv not found: installing"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Make uv available in this shell (installer adds it to ~/.local/bin).
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  command -v uv >/dev/null 2>&1 || { echo "uv install failed; open a new shell or add ~/.local/bin to PATH"; exit 1; }
fi

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
