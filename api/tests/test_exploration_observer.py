"""Tests for the exploration observer (#324, ADR 0010 §1-3).

Transport-only mocking: a fake Node subprocess (:class:`FakeProc`) stands in for
``explore_session.cjs`` so ``observe()`` yields an accessibility snapshot +
interactive-DOM extract from a fixture page payload, and action normalization /
gating are exercised without a real browser (ADR 0001 — real engines are mocked
only at the transport boundary).
"""

from __future__ import annotations

import json

import pytest

from app.services import exploration_observer
from app.services.exploration_observer import (
    ExplorationObserver,
    locator_strategy,
    render_observation,
)

# A fixture "page" — the distilled interactive DOM + accessibility tree the Node
# driver would return for an `observe` on a real screen.
FIXTURE_ELEMENTS = [
    {"tag": "input", "testId": "search", "name": "q", "type": "text", "placeholder": "Search"},
    {"tag": "button", "role": "button", "text": "Submit"},
    {"tag": "a", "id": "nav-divisions", "text": "Divisions"},
]
FIXTURE_A11Y = {
    "role": "WebArea",
    "name": "Divisions",
    "children": [
        {"role": "textbox", "name": "Search"},
        {"role": "button", "name": "Submit"},
        {"role": "link", "name": "Divisions"},
    ],
}


class _FakeStream:
    """A minimal stdout/stderr stand-in that yields preloaded lines via readline."""

    def __init__(self, lines: list[str]) -> None:
        self._lines = list(lines)

    def readline(self) -> str:
        return self._lines.pop(0) if self._lines else ""


class _FakeStdin:
    """A stdin stand-in that records every command line written to it."""

    def __init__(self) -> None:
        self.writes: list[str] = []

    def write(self, s: str) -> None:
        self.writes.append(s)

    def flush(self) -> None:
        pass


class FakeProc:
    """A fake ``subprocess.Popen`` for the Node driver.

    Emits the driver's readiness handshake first, then one canned response per
    command the observer sends, and records the command lines written to stdin so
    tests can assert the driver command an action normalizes to.
    """

    def __init__(self, responses: list[dict]) -> None:
        lines = [json.dumps({"ok": True, "ready": True}) + "\n"]
        lines += [json.dumps(r) + "\n" for r in responses]
        self.stdout = _FakeStream(lines)
        self.stderr = _FakeStream([])
        self.stdin = _FakeStdin()
        self._alive = True

    def poll(self):
        return None if self._alive else 0

    def wait(self, timeout=None):
        self._alive = False
        return 0

    def kill(self):
        self._alive = False


def _observer_with(monkeypatch, responses: list[dict]) -> tuple[ExplorationObserver, FakeProc]:
    """Build an observer whose subprocess is a :class:`FakeProc` with ``responses``."""
    proc = FakeProc(responses)
    monkeypatch.setattr(exploration_observer.subprocess, "Popen", lambda *a, **k: proc)
    return ExplorationObserver("https://app.example.test"), proc


def _last_command(proc: FakeProc) -> dict:
    """Parse the last JSON command line written to the fake driver's stdin."""
    return json.loads(proc.stdin.writes[-1])


# ------------------------------------------------------------------- observe
def test_observe_normalizes_fixture_page(monkeypatch):
    """observe() yields a usable accessibility snapshot + interactive-DOM extract."""
    obs, _ = _observer_with(
        monkeypatch,
        [{"ok": True, "url": "https://app.example.test/divisions", "path": "/divisions",
          "a11y": FIXTURE_A11Y, "elements": FIXTURE_ELEMENTS}],
    )
    result = obs.observe()

    assert result["accessibility"] == FIXTURE_A11Y
    assert result["elements"] == FIXTURE_ELEMENTS
    assert result["url"] == "https://app.example.test/divisions"
    assert result["path"] == "/divisions"


def test_observe_sends_observe_command(monkeypatch):
    obs, proc = _observer_with(monkeypatch, [{"ok": True, "elements": [], "a11y": None}])
    obs.observe()
    assert _last_command(proc) == {"cmd": "observe"}


# ------------------------------------------------------------- session replay
def test_driver_gets_storage_and_session_state(monkeypatch):
    """The driver is launched with BOTH storageState and the sessionStorage arg.

    Regression for #392: exploration must replay the captured sessionStorage
    (MSAL/SPA auth tokens) — passed as the 3rd argv after storageState — the same
    way a run does, or the saved session boots unauthenticated.
    """
    captured: dict = {}

    def _fake_popen(cmd, *a, **k):
        captured["cmd"] = cmd
        return FakeProc([{"ok": True, "elements": [], "a11y": None}])

    monkeypatch.setattr(exploration_observer.subprocess, "Popen", _fake_popen)
    obs = ExplorationObserver(
        "https://app.example.test",
        storage_state="/auth/storageState.json",
        session_state="/auth/sessionStorage.json",
    )
    obs.observe()

    assert captured["cmd"][-2:] == ["/auth/storageState.json", "/auth/sessionStorage.json"]


def test_driver_omits_session_state_without_storage(monkeypatch):
    """No storageState → the sessionStorage arg is not appended (positional after it)."""
    captured: dict = {}

    def _fake_popen(cmd, *a, **k):
        captured["cmd"] = cmd
        return FakeProc([{"ok": True, "elements": [], "a11y": None}])

    monkeypatch.setattr(exploration_observer.subprocess, "Popen", _fake_popen)
    obs = ExplorationObserver("https://app.example.test", session_state="/auth/sessionStorage.json")
    obs.observe()

    assert "/auth/sessionStorage.json" not in captured["cmd"]


# -------------------------------------------------------- action normalization
@pytest.mark.parametrize(
    "action,expected",
    [
        (
            {"action": "goto", "args": {"url": "/divisions"}},
            {"cmd": "act", "action": "goto", "args": {"url": "/divisions"}},
        ),
        (
            {"action": "click", "args": {"role": "tab", "name": "Divisions"}},
            {"cmd": "act", "action": "click", "args": {"role": "tab", "name": "Divisions"}},
        ),
        (
            {"action": "click", "args": {"selector": "#nav-divisions"}},
            {"cmd": "act", "action": "click", "args": {"selector": "#nav-divisions"}},
        ),
        (
            {"action": "expectVisible", "args": {"role": "heading", "name": "Divisions"}},
            {"cmd": "act", "action": "expectVisible", "args": {"role": "heading", "name": "Divisions"}},
        ),
    ],
)
def test_action_normalizes_to_driver_command(monkeypatch, action, expected):
    """Each read-only contract action maps to the right driver command."""
    obs, proc = _observer_with(monkeypatch, [{"ok": True, "error": None, "changed": True}])
    result = obs.act(action)
    assert result["ok"] is True
    assert _last_command(proc) == expected


def test_unknown_action_rejected(monkeypatch):
    """An action outside the fixed contract is refused, never sent to the driver."""
    obs, proc = _observer_with(monkeypatch, [])
    result = obs.act({"action": "scroll", "args": {}})
    assert result["ok"] is False
    assert "unknown action" in result["error"]
    assert proc.stdin.writes == []  # nothing dispatched


# --------------------------------------------------------- state-changing gate
def test_fill_gated_off_by_default(monkeypatch):
    """fill is state-changing: refused (untouched browser) when the flag is off."""
    obs, proc = _observer_with(monkeypatch, [])
    result = obs.act({"action": "fill", "args": {"selector": "#q", "value": "x"}})
    assert result["ok"] is False
    assert result["error"] == "state-changing action gated off"
    assert proc.stdin.writes == []


def test_fill_allowed_when_flag_set(monkeypatch):
    """With allow_state_changing=True, fill is normalized and dispatched."""
    obs, proc = _observer_with(monkeypatch, [{"ok": True, "error": None, "changed": True}])
    result = obs.act(
        {"action": "fill", "args": {"selector": "#q", "value": "x"}},
        allow_state_changing=True,
    )
    assert result["ok"] is True
    assert _last_command(proc) == {
        "cmd": "act", "action": "fill", "args": {"selector": "#q", "value": "x"},
    }


def test_submit_click_gated_off_by_default(monkeypatch):
    """A click flagged as a submit is state-changing and gated like fill."""
    obs, proc = _observer_with(monkeypatch, [])
    result = obs.act({"action": "click", "args": {"role": "button", "name": "Save", "submit": True}})
    assert result["ok"] is False
    assert result["error"] == "state-changing action gated off"
    assert proc.stdin.writes == []


def test_navigation_click_not_gated(monkeypatch):
    """A plain (non-submit) click is read-only and dispatched without the flag."""
    obs, proc = _observer_with(monkeypatch, [{"ok": True, "error": None, "changed": True}])
    result = obs.act({"action": "click", "args": {"role": "tab", "name": "Divisions"}})
    assert result["ok"] is True
    assert _last_command(proc)["action"] == "click"


# --------------------------------------------------- render + strategy helpers
def test_render_observation_lists_elements_and_path():
    text = render_observation(
        {"accessibility": FIXTURE_A11Y, "elements": FIXTURE_ELEMENTS,
         "url": "https://app.example.test/divisions", "path": "/divisions"}
    )
    assert "/divisions" in text
    assert "testid='search'" in text
    assert "text='Submit'" in text


def test_render_observation_empty_when_no_elements():
    assert render_observation({"elements": [], "path": "/x"}) == ""


def test_locator_strategy_priority():
    assert locator_strategy({"testId": "search"}) == "data-testid"
    assert locator_strategy({"selector": '[data-testid="search"]'}) == "data-testid"
    assert locator_strategy({"role": "button", "name": "Submit"}) == "role"
    assert locator_strategy({"label": "Email"}) == "label"
    assert locator_strategy({"selector": "#nav-divisions"}) == "css"
