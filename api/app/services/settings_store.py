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
    # Per-action model overrides, keyed by skill name (#175). Empty = every action
    # uses its built-in default / the global claudeModel (see claude_cli._resolve_model).
    "skillModels": {},
    # Ticket concurrency for the analyze+generate pipeline (#179); 0 = auto (3 on
    # Postgres, 1 on SQLite). See ai_service._resolve_worker_count.
    "aiPipelineWorkers": 0,
    "weeklyTokenBudget": 0,
    # Default execution target for new runs when a request doesn't specify one
    # (Local Agent feature — see EXEC_TARGETS): "server" (legacy in-process
    # runner) or "local-agent" (queued for a paired device to claim). Fresh
    # installs default to the user's machine ("My machine").
    "executionTarget": "local-agent",
    # Global spec quality-gate toggle (#gate-toggle). True = gate specs on
    # generation/edit/heal (default); False = bypass gating and accept every
    # spec as runnable. See placeholder_gate + automation._gate_spec_or_bypass.
    "gateEnabled": True,
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


def gate_enabled() -> bool:
    """Whether the global spec quality gate is active (default on).

    Read by the spec generation/edit/heal paths to decide whether to gate a spec
    or bypass gating entirely (#gate-toggle). Defaults to True for any install
    that predates the setting.
    """
    return bool(load_settings().get("gateEnabled", True))


def save_settings(data: dict[str, Any]) -> dict[str, Any]:
    """Persist settings (merged with existing values) and return the result."""
    current = load_settings()
    current.update({k: v for k, v in data.items() if v is not None})
    app_settings.workspace_dir.mkdir(parents=True, exist_ok=True)
    _settings_path().write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current
