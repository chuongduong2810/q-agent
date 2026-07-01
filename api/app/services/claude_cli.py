"""Claude CLI integration (local execution).

Wraps the locally-installed Claude Code CLI in headless "print" mode to run
one-shot prompts for requirement analysis, test-case generation and Playwright
spec generation.

Invocation shape::

    claude -p "<prompt>" --output-format json --model <model>

In JSON output mode the CLI prints an envelope whose ``result`` field carries the
assistant's final text. We extract that, and for structured calls we ask the
model to emit a fenced JSON block and parse it.

Per ADR 0001 there is **no simulated fallback**: if the CLI is missing, errors,
or times out, we raise :class:`ClaudeError` and the caller surfaces it.
"""

from __future__ import annotations

import json
import re
import subprocess
from typing import Any

from app.config import settings
from app.logging import logger


class ClaudeError(RuntimeError):
    """Raised when the Claude CLI is unavailable or returns an error."""


def _extract_json(text: str) -> Any:
    """Pull the first JSON object/array out of a model response."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        # Fall back to the first {...} or [...] span in the text.
        span = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        candidate = span.group(1) if span else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:  # noqa: TRY003
        raise ClaudeError(f"Claude returned non-JSON output: {exc}") from exc


def _compose_system(system: str | None, skill: str | None, include_template: bool) -> str | None:
    """Merge an explicit system prompt with a dedicated skill's SKILL.md."""
    if not skill:
        return system
    from app.services.skills import load_skill  # local import avoids any load-order coupling

    skill_text = load_skill(skill, include_template=include_template)
    if not skill_text:
        return system
    return f"{skill_text}\n\n{system}" if system else skill_text


def run_prompt(
    prompt: str,
    *,
    system: str | None = None,
    skill: str | None = None,
    include_template: bool = False,
    timeout: int | None = None,
    label: str | None = None,
) -> str:
    """Run a single prompt through the Claude CLI and return its text result.

    If ``skill`` is given, that dedicated Q-Agent skill's SKILL.md is injected as
    the system prompt so the action follows the skill's methodology.
    """
    system = _compose_system(system, skill, include_template)
    cmd = [
        settings.claude_bin,
        "-p",
        prompt,
        "--output-format",
        "json",
        "--model",
        settings.claude_model,
    ]
    if system:
        cmd += ["--append-system-prompt", system]

    # Register the call so operators can observe it live (logs + /ai/activity + WS).
    from app.services import activity

    call_id = activity.start(label or skill or "Claude CLI", skill)
    logger.info("Claude CLI: {} chars prompt, model={}", len(prompt), settings.claude_model)
    try:
        proc = subprocess.run(  # noqa: S603
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout or settings.claude_timeout_s,
            encoding="utf-8",
        )
    except FileNotFoundError as exc:  # noqa: TRY003
        activity.finish(call_id, ok=False, error="Claude CLI not found")
        raise ClaudeError(
            f"Claude CLI not found (looked for '{settings.claude_bin}'). Install it and "
            "authenticate with `claude login`."
        ) from exc
    except subprocess.TimeoutExpired as exc:  # noqa: TRY003
        activity.finish(call_id, ok=False, error="timed out")
        raise ClaudeError(f"Claude CLI timed out after {timeout or settings.claude_timeout_s}s") from exc
    except Exception as exc:  # noqa: BLE001
        activity.finish(call_id, ok=False, error=str(exc)[:200])
        raise

    if proc.returncode != 0:
        activity.finish(call_id, ok=False, error=f"exit {proc.returncode}")
        raise ClaudeError(f"Claude CLI exited {proc.returncode}: {proc.stderr.strip()[:500]}")

    activity.finish(call_id, ok=True)
    raw = proc.stdout.strip()
    # JSON envelope: {"type":"result","result":"...", ...}
    try:
        envelope = json.loads(raw)
        if isinstance(envelope, dict) and "result" in envelope:
            return str(envelope["result"])
    except json.JSONDecodeError:
        pass
    return raw


def run_json(
    prompt: str,
    *,
    system: str | None = None,
    skill: str | None = None,
    include_template: bool = False,
    timeout: int | None = None,
    label: str | None = None,
) -> Any:
    """Run a prompt expecting a JSON response and parse it.

    ``skill`` injects a dedicated Q-Agent skill; the JSON-only instruction still
    pins the machine-parseable output shape the backend consumes.
    """
    instruction = (
        "\n\nRespond with ONLY a single valid JSON value (object or array). "
        "Do not include prose or markdown fences."
    )
    text = run_prompt(
        prompt + instruction,
        system=system,
        skill=skill,
        include_template=include_template,
        timeout=timeout,
        label=label,
    )
    return _extract_json(text)


def is_available() -> bool:
    """Best-effort check that the CLI is present (does not verify auth)."""
    try:
        proc = subprocess.run(  # noqa: S603
            [settings.claude_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return proc.returncode == 0
    except (FileNotFoundError, subprocess.SubprocessError):
        return False
