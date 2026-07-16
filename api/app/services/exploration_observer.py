"""Observation helper + persistent Node browser driver wrapper (ADR 0010 §1-3).

This module is the Python half of the DOM Exploration Agent's observe→act
machinery. It launches and manages the long-lived Node Playwright driver
(``pw_scripts/explore_session.cjs``) over a line-delimited JSON protocol, and
exposes the primitives the (later) decide loop drives:

* :meth:`ExplorationObserver.observe` — one observation (accessibility tree +
  distilled interactive DOM + url/path), normalized for the model.
* :meth:`ExplorationObserver.act` — execute one fixed-contract action, gating
  state-changing actions off by default (ADR 0010 §8, read-mostly safety).
* :func:`render_observation` — a compact text form for the model prompt,
  mirroring :func:`app.services.prompts.render_dom_snapshot`.
* :func:`locator_strategy` — records which locator strategy an action used
  (``data-testid`` → ``role`` → ``label`` → ``css``), per ADR 0010 §3.

No decide loop, no stop conditions, no KB writes — those are separate slices.
The transport (the Node subprocess) is the only thing mocked in tests; there is
no simulated browser (ADR 0001).
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from app.config import settings
from app.logging import logger
from app.services import project_config_service

_EXPLORE_SCRIPT = Path(__file__).resolve().parent / "pw_scripts" / "explore_session.cjs"

# The fixed action contract (ADR 0010 §3). Anything else is rejected.
_ALLOWED_ACTIONS = frozenset({"goto", "click", "fill", "expectVisible"})


def _is_state_changing(action: str, args: dict[str, Any]) -> bool:
    """Whether an action mutates server/app state (ADR 0010 §8).

    ``fill`` always writes into an input; a ``click`` is state-changing only when
    the caller explicitly flags it as a submit (``args["submit"]``) — plain
    navigation clicks are read-only. ``goto``/``expectVisible`` never mutate.

    Args:
        action: The contract action name.
        args: The action arguments.

    Returns:
        True when the action must be gated behind ``allow_state_changing``.
    """
    if action == "fill":
        return True
    if action == "click" and args.get("submit"):
        return True
    return False


def locator_strategy(args: dict[str, Any]) -> str:
    """Record which locator strategy an action's args resolve to.

    Mirrors the ``automation-generator`` locator discipline (ADR 0010 §3): prefer
    ``data-testid`` → ``role`` → ``label`` → raw ``css``. Used by the (later) KB
    writer to stamp each discovered selector with the strategy that worked.

    Args:
        args: The action arguments (``testId`` / ``role`` / ``label`` /
            ``selector`` …).

    Returns:
        One of ``"data-testid"``, ``"role"``, ``"label"``, ``"css"``.
    """
    selector = args.get("selector") or ""
    if args.get("testId") or "data-testid" in selector or "data-test" in selector:
        return "data-testid"
    if args.get("role"):
        return "role"
    if args.get("label"):
        return "label"
    return "css"


def render_observation(obs: dict[str, Any], *, max_elements: int = 60) -> str:
    """Render an observation as compact text for the model prompt.

    Mirrors :func:`app.services.prompts.render_dom_snapshot`: lists the page's
    real interactable elements with the stable identifiers Playwright locators
    care about (test id, role, name, type, id, placeholder, text) and pins the
    current page path so the model grounds on observed values, not guesses.

    Args:
        obs: A normalized observation — ``{accessibility, elements, url, path}``.
        max_elements: Cap on rendered elements to bound prompt size. Elements
            carrying an explicit identifier are preferred over anonymous ones.

    Returns:
        A text block, or "" when the observation has no usable elements.
    """
    if not obs:
        return ""
    elements = obs.get("elements") or []
    if not elements:
        return ""

    def _has_identifier(el: dict) -> bool:
        return bool(
            el.get("testId") or el.get("role") or el.get("name")
            or el.get("text") or el.get("id") or el.get("placeholder")
        )

    identified = [e for e in elements if isinstance(e, dict) and _has_identifier(e)]
    ranked = (identified or [e for e in elements if isinstance(e, dict)])[:max_elements]

    def _fmt(el: dict) -> str:
        parts = [el.get("tag", "")]
        for key, label in (
            ("testId", "testid"), ("role", "role"), ("name", "name"),
            ("type", "type"), ("id", "id"), ("placeholder", "placeholder"),
        ):
            if el.get(key):
                parts.append(f"{label}={el[key]!r}")
        if el.get("text"):
            parts.append(f"text={el['text']!r}")
        return "  - " + " ".join(p for p in parts if p)

    lines = ["Live page observed — real interactable elements (prefer these over guesses):"]
    loc = obs.get("path") or obs.get("url") or ""
    if loc:
        lines.append(f"- Current page: {loc}")
    lines.extend(_fmt(e) for e in ranked)
    if len(elements) > len(ranked):
        lines.append(f"  … ({len(elements) - len(ranked)} more elements omitted)")
    return "\n".join(lines)


class ExplorationObserver:
    """Launches and drives the persistent Node Playwright browser (ADR 0010 §1).

    Owns one ``explore_session.cjs`` subprocess holding a single browser + page
    open for the session, and talks to it over a line-delimited JSON protocol.
    Use as a context manager so the subprocess is never leaked::

        with ExplorationObserver(base_url, project_key="P", owner_id=1) as obs:
            snapshot = obs.observe()
            obs.act({"action": "click", "args": {"role": "tab", "name": "Divisions"}})

    Args:
        base_url: The application base URL (injected as Playwright ``baseURL`` so
            relative ``goto('/path')`` resolves).
        storage_state: Optional absolute path to a saved Playwright session for
            auth reuse. When omitted and ``project_key`` is given, it is resolved
            via :func:`project_config_service.auth_path` (used only if it exists).
        session_state: Optional absolute path to the sibling ``sessionStorage.json``
            snapshot (MSAL/SPA tokens Playwright's ``storageState`` cannot persist),
            replayed into the browser for auth reuse. When omitted and
            ``project_key`` resolved a ``storage_state``, it is resolved via
            :func:`project_config_service.session_path` (used only if it exists).
        project_key: Optional project key, used to resolve ``storage_state`` /
            ``session_state`` from the project's saved auth session.
        owner_id: Optional workspace owner scope for the auth-path resolution.
    """

    def __init__(
        self,
        base_url: str,
        storage_state: str | Path | None = None,
        *,
        session_state: str | Path | None = None,
        project_key: str | None = None,
        owner_id: int | None = None,
    ) -> None:
        self.base_url = base_url
        if storage_state is None and project_key is not None:
            resolved = project_config_service.auth_path(project_key, owner_id)
            storage_state = resolved if resolved.exists() else None
            # Pair the sessionStorage snapshot with the saved session so the
            # explore browser authenticates the same way a run does (the run path
            # replays it via fixtures — playwright_runner._apply_fixtures).
            if storage_state is not None and session_state is None:
                sess = project_config_service.session_path(project_key, owner_id)
                session_state = sess if sess.exists() else None
        self.storage_state = str(storage_state) if storage_state else None
        self.session_state = str(session_state) if session_state else None
        self._proc: subprocess.Popen[str] | None = None

    # ---------------------------------------------------------------- transport
    def _ensure_started(self) -> subprocess.Popen[str]:
        """Start the Node driver subprocess (idempotent) and await its ready line.

        Points ``NODE_PATH`` at the configured Playwright install (the same env as
        :func:`playwright_runner._invoke_playwright`) so the script's
        ``require('playwright')`` resolves, and runs it with cwd = that
        node_modules dir.

        Returns:
            The live subprocess handle.
        """
        if self._proc is not None and self._proc.poll() is None:
            return self._proc

        nm = str(settings.playwright_node_modules)
        env = os.environ.copy()
        env["NODE_PATH"] = nm + (os.pathsep + env["NODE_PATH"] if env.get("NODE_PATH") else "")
        cmd = ["node", str(_EXPLORE_SCRIPT), self.base_url]
        if self.storage_state:
            cmd.append(self.storage_state)
            # sessionStorage replay is positional after storageState (it only
            # makes sense paired with the saved session), matching the run path.
            if self.session_state:
                cmd.append(self.session_state)
        logger.info("Exploration driver: {} (cwd={})", " ".join(cmd), nm)
        self._proc = subprocess.Popen(  # noqa: S603
            cmd,
            cwd=nm,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        # First line is the driver's readiness handshake ({ready:true}).
        self._read_line()
        return self._proc

    def _read_line(self) -> dict[str, Any]:
        """Read one newline-delimited JSON response from the driver's stdout.

        Returns:
            The parsed response object.

        Raises:
            RuntimeError: If the driver closed its stdout (process died).
        """
        proc = self._proc
        assert proc is not None and proc.stdout is not None
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("exploration driver produced no output (process exited)")
        return json.loads(line)

    def _send(self, command: dict[str, Any]) -> dict[str, Any]:
        """Send one command to the driver and return its parsed response.

        Args:
            command: The driver command (e.g. ``{"cmd": "observe"}``).

        Returns:
            The driver's JSON response as a dict.
        """
        proc = self._ensure_started()
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(command) + "\n")
        proc.stdin.flush()
        return self._read_line()

    # ------------------------------------------------------------- observe / act
    def observe(self) -> dict[str, Any]:
        """Observe the current page.

        Returns:
            A normalized observation ``{accessibility, elements, url, path}`` where
            ``accessibility`` is ``page.accessibility.snapshot()`` (role+name tree)
            and ``elements`` is the distilled interactive-DOM extract (same shape
            as the self-heal distilled DOM).
        """
        resp = self._send({"cmd": "observe"})
        return {
            "accessibility": resp.get("a11y"),
            "elements": resp.get("elements") or [],
            "url": resp.get("url"),
            "path": resp.get("path"),
        }

    def act(self, action: dict[str, Any], *, allow_state_changing: bool = False) -> dict[str, Any]:
        """Normalize and execute one contract action.

        Maps a contract action ``{"action": .., "args": {..}}`` to a driver
        command and sends it. Unknown actions are rejected. State-changing actions
        (``fill``, submit clicks) are refused unless ``allow_state_changing`` is
        set — the read-mostly default of ADR 0010 §8.

        Args:
            action: A contract action dict, ``{"action": str, "args": dict}``.
            allow_state_changing: When False (default), ``fill`` and submit clicks
                are refused without touching the browser.

        Returns:
            The driver's ``{ok, error, changed}`` result, or a synthetic
            ``{ok: False, error, changed: False}`` for a rejected/gated action.
        """
        name = action.get("action")
        args = action.get("args") or {}
        if name not in _ALLOWED_ACTIONS:
            return {"ok": False, "error": f"unknown action: {name!r}", "changed": False}
        if not allow_state_changing and _is_state_changing(name, args):
            return {"ok": False, "error": "state-changing action gated off", "changed": False}
        return self._send({"cmd": "act", "action": name, "args": args})

    # -------------------------------------------------------------- lifecycle
    def close(self) -> None:
        """Close the browser and terminate the driver subprocess (idempotent)."""
        proc = self._proc
        if proc is None:
            return
        try:
            if proc.poll() is None and proc.stdin is not None:
                proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                proc.stdin.flush()
                proc.wait(timeout=10)
        except Exception:  # noqa: BLE001 - close must never raise
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._proc = None

    def __enter__(self) -> "ExplorationObserver":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
