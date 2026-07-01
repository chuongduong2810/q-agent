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


def run_prompt(prompt: str, *, system: str | None = None, timeout: int | None = None) -> str:
    """Run a single prompt through the Claude CLI and return its text result."""
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
        raise ClaudeError(
            f"Claude CLI not found (looked for '{settings.claude_bin}'). Install it and "
            "authenticate with `claude login`."
        ) from exc
    except subprocess.TimeoutExpired as exc:  # noqa: TRY003
        raise ClaudeError(f"Claude CLI timed out after {timeout or settings.claude_timeout_s}s") from exc

    if proc.returncode != 0:
        raise ClaudeError(f"Claude CLI exited {proc.returncode}: {proc.stderr.strip()[:500]}")

    raw = proc.stdout.strip()
    # JSON envelope: {"type":"result","result":"...", ...}
    try:
        envelope = json.loads(raw)
        if isinstance(envelope, dict) and "result" in envelope:
            return str(envelope["result"])
    except json.JSONDecodeError:
        pass
    return raw


def run_json(prompt: str, *, system: str | None = None, timeout: int | None = None) -> Any:
    """Run a prompt expecting a JSON response and parse it."""
    instruction = (
        "\n\nRespond with ONLY a single valid JSON value (object or array). "
        "Do not include prose or markdown fences."
    )
    text = run_prompt(prompt + instruction, system=system, timeout=timeout)
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
