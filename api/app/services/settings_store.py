"""Persistence for app-wide execution settings (`SettingsOut` fields).

Settings are not tied to any provider or run, so they don't need a DB model —
they're small, local-first config persisted as JSON under the workspace dir.
"""

from __future__ import annotations

import json
from typing import Any

from app.config import settings as app_settings

DEFAULTS: dict[str, Any] = {
    "parallel": 4,
    "retryFlaky": True,
    "screenshotOnFail": True,
    "video": False,
    "maxCasesPerTicket": 8,
    "headless": True,
    "autoAnnotate": True,
    "neuralBackground": True,
    "claudeModel": "claude-sonnet-5",
    "weeklyTokenBudget": 0,
    # Default execution target for new runs when a request doesn't specify one
    # (Local Agent feature — see EXEC_TARGETS): "server" (legacy in-process
    # runner) or "local-agent" (queued for a paired device to claim).
    "executionTarget": "server",
}


def _settings_path():
    return app_settings.workspace_dir / "settings.json"


def load_settings() -> dict[str, Any]:
    """Load persisted settings, falling back to defaults for missing keys."""
    path = _settings_path()
    if not path.exists():
        return dict(DEFAULTS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULTS)
    merged = dict(DEFAULTS)
    merged.update(data)
    return merged


def save_settings(data: dict[str, Any]) -> dict[str, Any]:
    """Persist settings (merged with existing values) and return the result."""
    current = load_settings()
    current.update({k: v for k, v in data.items() if v is not None})
    app_settings.workspace_dir.mkdir(parents=True, exist_ok=True)
    _settings_path().write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current
