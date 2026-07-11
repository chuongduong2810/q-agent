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
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any

from app.config import settings
from app.logging import logger


class ClaudeError(RuntimeError):
    """Raised when the Claude CLI is unavailable or returns an error."""


def _resolve_model() -> str:
    """Return the operator-selected Claude model, falling back to config.

    The chosen model lives in the app-wide settings store (set from the Settings
    screen); a blank/missing value falls back to ``settings.claude_model`` so
    every CLI call inherits the selection with no per-caller changes.
    """
    from app.services import settings_store  # local import avoids load-order coupling

    return settings_store.load_settings().get("claudeModel") or settings.claude_model


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


def _record_usage(
    envelope: dict | None, *, model: str, action: str, wall_ms: int, owner_id: int | None
) -> None:
    """Best-effort: log a successful call's real token/cost/latency usage.

    Parses the CLI's JSON result envelope for ``total_cost_usd``, ``usage`` token
    counts and ``duration_ms`` (falling back to the measured wall-clock time), and
    hands them to :func:`ai_usage_service.record`. ``owner_id`` stamps the row for
    per-user cost attribution (#95) — the same user whose credentials the call
    ran under (see :func:`_resolve_claude_env`). Wrapped so a logging failure can
    never break the Claude call it observes.
    """
    try:
        from app.services import ai_usage_service

        env = envelope or {}
        usage = env.get("usage") or {}
        duration = env.get("duration_ms")
        ai_usage_service.record(
            model=model,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read=usage.get("cache_read_input_tokens", 0),
            cache_write=usage.get("cache_creation_input_tokens", 0),
            cost_usd=env.get("total_cost_usd", 0.0),
            duration_ms=int(duration) if isinstance(duration, (int, float)) else wall_ms,
            action=action,
            owner_id=owner_id,
        )
    except Exception as exc:  # noqa: BLE001 - usage capture is additive + best-effort
        logger.warning("Claude usage capture skipped: {}", exc)


def _resolve_cwd(cwd: str | Path | None) -> str | None:
    """Return an existing directory to run the CLI in, or None (inherit ours)."""
    if not cwd:
        return None
    path = Path(cwd)
    return str(path) if path.is_dir() else None


def _resolve_claude_env() -> tuple[dict[str, str], int | None]:
    """Resolve the effective Claude credentials and build the subprocess env.

    Resolves the current owner (see
    :func:`app.services.claude_credentials.resolve_ambient_owner_id`), then that
    user's own credential, else the shared/admin credential (#95), materializes
    it into a private config dir, and returns ``(env, owner_id)`` where ``env``
    points ``CLAUDE_CONFIG_DIR`` at that dir. ``owner_id`` is also returned so the
    caller can stamp the usage row with the same user. Raises :class:`ClaudeError`
    when no credential is configured at all — there is no interactive
    ``claude login`` fallback (ADR 0001).
    """
    from app.db import SessionLocal
    from app.services import claude_credentials

    owner_id = claude_credentials.resolve_ambient_owner_id()
    db = SessionLocal()
    try:
        config_dir = claude_credentials.resolve_effective_config_dir(db, owner_id)
    finally:
        db.close()
    if config_dir is None:
        raise ClaudeError(
            "No Claude credentials configured. Upload your own credentials in "
            "Settings, or ask an admin to configure the shared credential."
        )
    return {**os.environ, "CLAUDE_CONFIG_DIR": str(config_dir)}, owner_id


def _mark_credential_invalid(owner_id: int | None) -> None:
    """Best-effort: flag the effective credential ``expired`` after a call failed
    with an auth error, so the header/AI-stats reflect it without a separate
    probe (Layer 1). Never raises."""
    from app.db import SessionLocal
    from app.models.claude_credentials import STATUS_EXPIRED
    from app.services import claude_credentials

    try:
        db = SessionLocal()
        try:
            claude_credentials.set_effective_status(db, owner_id, STATUS_EXPIRED)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not flag Claude credential invalid: {}", exc)


def _persist_refreshed_credential(owner_id: int | None) -> None:
    """Best-effort: capture any token the CLI just refreshed back into the store
    (see :func:`app.services.claude_credentials.persist_refreshed`). Never raises
    — credential bookkeeping must not fail a CLI run."""
    from app.db import SessionLocal
    from app.services import claude_credentials

    try:
        db = SessionLocal()
        try:
            claude_credentials.persist_refreshed(db, owner_id)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist refreshed Claude credential: {}", exc)


def run_prompt(
    prompt: str,
    *,
    system: str | None = None,
    skill: str | None = None,
    include_template: bool = False,
    timeout: int | None = None,
    label: str | None = None,
    cwd: str | Path | None = None,
) -> str:
    """Run a single prompt through the Claude CLI and return its text result.

    If ``skill`` is given, that dedicated Q-Agent skill's SKILL.md is injected as
    the system prompt so the action follows the skill's methodology. If ``cwd`` is
    an existing directory, the CLI runs there so its file tools can traverse that
    codebase (used by project-bootstrap against a local repo clone).
    """
    system = _compose_system(system, skill, include_template)
    model = _resolve_model()
    cmd = [
        settings.claude_bin,
        "-p",
        prompt,
        "--output-format",
        "json",
        "--model",
        model,
    ]
    if system:
        cmd += ["--append-system-prompt", system]
    resolved_cwd = _resolve_cwd(cwd)
    env, owner_id = _resolve_claude_env()

    # Register the call so operators can observe it live (logs + /ai/activity + WS).
    from app.services import activity

    call_id = activity.start(label or skill or "Claude CLI", skill)
    logger.info("Claude CLI: {} chars prompt, model={}", len(prompt), model)
    t0 = time.monotonic()
    try:
        proc = subprocess.run(  # noqa: S603
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout or settings.claude_timeout_s,
            encoding="utf-8",
            cwd=resolved_cwd,
            env=env,
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

    # If the CLI refreshed the (short-lived) OAuth access token in-place, capture
    # it back into the store so the credential doesn't silently expire between
    # calls. Guarded + best-effort — never let this bookkeeping break the run.
    _persist_refreshed_credential(owner_id)

    if proc.returncode != 0:
        # `claude -p --output-format json` writes its failure reason (auth /
        # credit / rate-limit / unknown-model) to STDOUT as JSON and leaves
        # STDERR empty — so a bare `exited 1:` message hides the real cause.
        # Surface stdout when stderr is empty, and log both streams in full.
        err = proc.stderr.strip()
        out = proc.stdout.strip()
        logger.error(
            "Claude CLI exited {}: stderr={!r} stdout={!r}",
            proc.returncode,
            err[:800],
            out[:800],
        )
        activity.finish(call_id, ok=False, error=f"exit {proc.returncode}")
        # Feed an auth failure back into the stored credential so the UI can flag
        # it (Layer 1) — the CLI writes "Not logged in · Please run /login" to
        # stdout as JSON when the token is expired/revoked.
        if "not logged in" in (out + err).lower() or "please run /login" in (out + err).lower():
            _mark_credential_invalid(owner_id)
        detail = (err or out or "no output on stderr/stdout")[:800]
        raise ClaudeError(f"Claude CLI exited {proc.returncode}: {detail}")

    activity.finish(call_id, ok=True)
    wall_ms = int((time.monotonic() - t0) * 1000)
    raw = proc.stdout.strip()
    # JSON envelope: {"type":"result","result":"...","usage":{...},"total_cost_usd":...}
    envelope: dict | None = None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            envelope = parsed
    except json.JSONDecodeError:
        pass
    # Capture real per-call usage (tokens/cost/latency) for the stats panel.
    # Record the skill (not the per-call label) as the action so per-run cost
    # attribution can group calls by process; run_id is read from the ambient
    # run context inside ai_usage_service.record.
    _record_usage(
        envelope,
        model=model,
        action=skill or label or "Claude CLI",
        wall_ms=wall_ms,
        owner_id=owner_id,
    )
    if envelope is not None and "result" in envelope:
        return str(envelope["result"])
    return raw


def run_json(
    prompt: str,
    *,
    system: str | None = None,
    skill: str | None = None,
    include_template: bool = False,
    timeout: int | None = None,
    label: str | None = None,
    cwd: str | Path | None = None,
) -> Any:
    """Run a prompt expecting a JSON response and parse it.

    ``skill`` injects a dedicated Q-Agent skill; the JSON-only instruction still
    pins the machine-parseable output shape the backend consumes. ``cwd`` runs the
    CLI in a codebase directory so its file tools can read that project.
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
        cwd=cwd,
    )
    return _extract_json(text)


def verify_credentials(config_dir: str | Path) -> tuple[str, str]:
    """Run a minimal prompt under an explicit ``CLAUDE_CONFIG_DIR`` and classify
    the outcome for the credential-test endpoint.

    Returns ``(result, message)`` where ``result`` is one of:
      * ``"ok"``      — the credential authenticated and Claude replied.
      * ``"invalid"`` — the CLI reported "Not logged in" (expired/revoked token).
      * ``"error"``   — anything else (CLI missing, timeout, rate-limit, …).

    Deliberately does NOT record usage/activity or resolve ambient owners — the
    caller passes the exact config dir to test (see ``routers.ai.test_credentials``),
    so testing user A's credential never accidentally probes the shared one.
    """
    env = {**os.environ, "CLAUDE_CONFIG_DIR": str(config_dir)}
    cmd = [
        settings.claude_bin,
        "-p",
        "Reply with exactly: ok",
        "--output-format",
        "json",
        "--model",
        _resolve_model(),
    ]
    try:
        proc = subprocess.run(  # noqa: S603
            cmd, capture_output=True, text=True, timeout=60, encoding="utf-8", env=env
        )
    except FileNotFoundError:
        return ("error", f"Claude CLI not found (looked for '{settings.claude_bin}').")
    except subprocess.TimeoutExpired:
        return ("error", "Claude CLI timed out while testing the credential.")
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode == 0:
        try:
            envelope = json.loads(out)
            is_error = isinstance(envelope, dict) and bool(envelope.get("is_error"))
        except json.JSONDecodeError:
            is_error = False
        if not is_error:
            return ("ok", "Credential is valid — Claude responded.")
    combined = f"{out}\n{err}".lower()
    if "not logged in" in combined or "please run /login" in combined:
        return ("invalid", "Not logged in — the token is expired or revoked. Re-upload it.")
    return ("error", (err or out or "Unknown error")[:200])


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
