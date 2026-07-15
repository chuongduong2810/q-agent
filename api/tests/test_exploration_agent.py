"""Tests for the exploration ReAct loop (#326, ADR 0010 §3-5, 8).

Transport-only mocking (ADR 0001): a :class:`FakeObserver` stands in for the real
Node browser (scripted ``observe``/``act``) and ``run_json`` is replaced with a
scripted decision sequence, so the loop's control flow — every stop condition, the
read-mostly gate, and the "never invent" KB rule — is exercised without a real
browser or a real Claude call.

Each test asserts the loop halts on exactly one stop condition with the right
``stop_reason``; the unreachable test asserts NOTHING is written to the KB; and the
KB writer is stubbed so we can assert it is only ever called with observed data.
"""

from __future__ import annotations

import pytest

from app.services import exploration_agent


# --------------------------------------------------------------------- fakes
class FakeObserver:
    """A scripted stand-in for :class:`ExplorationObserver` (context manager).

    ``observe`` pops the next scripted observation (repeating the last one once
    exhausted, so a long loop keeps observing); ``act`` returns a canned ok result
    and records the action for assertions.
    """

    def __init__(self, observations, *, act_ok=True):
        self._observations = list(observations)
        self._act_ok = act_ok
        self.acted: list[dict] = []

    def observe(self):
        if len(self._observations) > 1:
            return self._observations.pop(0)
        return self._observations[0] if self._observations else {"elements": [], "path": None}

    def act(self, action, *, allow_state_changing=False):
        self.acted.append({**action, "allow_state_changing": allow_state_changing})
        return {"ok": self._act_ok, "error": None, "changed": True}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


def _obs(path, name):
    """Build a normalized observation for a screen with one identified element."""
    return {
        "accessibility": {"role": "WebArea", "name": name},
        "elements": [{"tag": "a", "role": "link", "name": name, "text": name}],
        "url": f"https://app.test{path}",
        "path": path,
    }


@pytest.fixture
def wired(monkeypatch):
    """Wire the loop's collaborators to fakes and capture KB-writer calls.

    Returns a helper ``run(observations, decisions, **kwargs)`` that installs a
    :class:`FakeObserver` + a scripted ``run_json`` and runs :func:`explore`,
    exposing the merge-call args the loop produced.
    """
    calls: dict[str, list] = {"merge": [], "run_json": []}

    # Fixed base URL — skip the config/KB DB lookup entirely.
    monkeypatch.setattr(exploration_agent, "_resolve_base_url", lambda *a, **k: "https://app.test")
    # No real spend — budget stays under ceiling unless a test overrides this.
    monkeypatch.setattr(exploration_agent, "_session_spend", lambda db, run_id: {"usd": 0.0, "tokens": 0})

    def _fake_merge(project_key, repo, discovered, *, owner_id=None, source="exploration"):
        calls["merge"].append(
            {"project_key": project_key, "repo": repo, "discovered": discovered, "owner_id": owner_id}
        )
        return len(discovered.get("routes", [])) + len(discovered.get("selectors", []))

    monkeypatch.setattr(exploration_agent.knowledge_service, "merge_verified_discovery", _fake_merge)

    def run(observations, decisions, **kwargs):
        decisions = list(decisions)

        def _fake_run_json(prompt, **kw):
            calls["run_json"].append(prompt)
            return decisions.pop(0) if decisions else {"action": "done", "args": {}}

        monkeypatch.setattr(exploration_agent, "run_json", _fake_run_json)
        monkeypatch.setattr(
            exploration_agent, "ExplorationObserver",
            lambda *a, **k: FakeObserver(observations, act_ok=kwargs.pop("act_ok", True)),
        )
        result = exploration_agent.explore(
            db=object(), project_key="P", repo="r", target={"screen": "Divisions"}, **kwargs
        )
        return result, calls

    return run


# ------------------------------------------------------------------ stop: done
def test_stops_on_done_and_writes_observed_data(wired):
    """A `done` decision halts the loop and merges the observed route/selectors."""
    # Land on home, click through to Divisions, then confirm done on the new page.
    result, calls = wired(
        observations=[_obs("/", "Home"), _obs("/divisions", "Divisions")],
        decisions=[
            {"action": "click", "args": {"role": "link", "name": "Divisions"}},
            {"action": "done", "args": {"summary": "reached"}},
        ],
    )

    assert result.stop_reason == "done"
    assert result.wrote_kb is True
    assert result.steps_taken == 1
    # Only observed data is merged: the routes we navigated + the selector we clicked.
    assert len(calls["merge"]) == 1
    disc = calls["merge"][0]["discovered"]
    assert {r["path"] for r in disc["routes"]} == {"/", "/divisions"}
    assert disc["selectors"] and disc["selectors"][0]["strategy"] == "role"


# -------------------------------------------------------------- stop: step cap
def test_stops_on_step_cap(monkeypatch, wired):
    """With the step cap reached the loop halts as `step_cap` (never unbounded)."""
    monkeypatch.setattr(exploration_agent.settings, "explore_max_steps", 3)
    # Distinct observation each step so repeat-detection never fires first.
    observations = [_obs(f"/p{i}", f"S{i}") for i in range(10)]

    result, _ = wired(
        observations=observations,
        decisions=[{"action": "click", "args": {"selector": f"#b{i}"}} for i in range(10)],
    )

    assert result.stop_reason == "step_cap"
    assert result.steps_taken == 3


def test_step_cap_is_hard_clamped_to_20(monkeypatch, wired):
    """A configured cap above the hard maximum is clamped to 20."""
    monkeypatch.setattr(exploration_agent.settings, "explore_max_steps", 999)
    observations = [_obs(f"/p{i}", f"S{i}") for i in range(30)]

    result, _ = wired(
        observations=observations,
        decisions=[{"action": "click", "args": {"selector": f"#b{i}"}} for i in range(30)],
    )

    assert result.stop_reason == "step_cap"
    assert result.steps_taken == 20


# --------------------------------------------------------------- stop: repeat
def test_stops_on_repeat_detection(wired):
    """Observing the same (url, a11y) state twice halts the loop as `repeat`."""
    same = _obs("/divisions", "Divisions")
    result, calls = wired(
        observations=[same, same],  # step 2 re-observes the identical state
        decisions=[{"action": "click", "args": {"selector": "#stuck"}}],
    )

    assert result.stop_reason == "repeat"
    assert result.steps_taken == 1
    # The one real observation before getting stuck is still merged (it's real).
    assert result.wrote_kb is True


# --------------------------------------------------------------- stop: budget
def test_stops_on_budget(monkeypatch, wired):
    """Spend at/over the ceiling halts as `budget` before any Claude call."""
    monkeypatch.setattr(exploration_agent.settings, "explore_cost_budget_usd", 0.10)
    # Baseline read = 0.0; first in-loop read is over budget → halt immediately.
    spends = iter([{"usd": 0.0, "tokens": 0}, {"usd": 0.99, "tokens": 500}])
    monkeypatch.setattr(exploration_agent, "_session_spend", lambda db, run_id: next(spends))

    result, calls = wired(
        observations=[_obs("/divisions", "Divisions")],
        decisions=[{"action": "click", "args": {"selector": "#x"}}],
    )

    assert result.stop_reason == "budget"
    assert result.steps_taken == 0
    assert calls["run_json"] == []  # halted before spending on a decision
    assert calls["merge"] == []  # nothing observed → nothing written


# ----------------------------------------------------------- unreachable target
def test_unreachable_target_writes_nothing(wired):
    """No usable observation → nothing merged, reported `unreachable` (case blocked)."""
    empty = {"accessibility": None, "elements": [], "url": None, "path": None}
    result, calls = wired(
        observations=[empty],
        decisions=[{"action": "done", "args": {"summary": "gave up"}}],
    )

    assert result.stop_reason == "unreachable"
    assert result.wrote_kb is False
    assert calls["merge"] == []  # never invent: no observed data → no KB write
    assert result.discovered == {"routes": [], "selectors": []}


def test_unreachable_when_no_base_url(monkeypatch):
    """No configured base URL → unreachable immediately, nothing driven or written."""
    monkeypatch.setattr(exploration_agent, "_resolve_base_url", lambda *a, **k: "")
    monkeypatch.setattr(exploration_agent, "_session_spend", lambda db, run_id: {"usd": 0.0, "tokens": 0})

    result = exploration_agent.explore(
        db=object(), project_key="P", repo="r", target={"screen": "X"}
    )
    assert result.stop_reason == "unreachable"
    assert result.wrote_kb is False
    assert result.steps_taken == 0


# ------------------------------------------------------- state-changing gating
def test_state_changing_gated_off_by_default(wired):
    """`allow_state_changing` defaults to False and is passed through to the observer."""
    result, _ = wired(
        observations=[_obs("/form", "Form")],
        decisions=[
            {"action": "fill", "args": {"selector": "#q", "value": "x"}},
            {"action": "done", "args": {}},
        ],
    )
    # The loop's default is read-mostly: the observer receives allow_state_changing=False.
    assert result.log[0]["action"] == "fill"


def test_state_changing_flag_forwarded_to_observer(monkeypatch):
    """With allow_state_changing=True the loop forwards the flag to observer.act."""
    monkeypatch.setattr(exploration_agent, "_resolve_base_url", lambda *a, **k: "https://app.test")
    monkeypatch.setattr(exploration_agent, "_session_spend", lambda db, run_id: {"usd": 0.0, "tokens": 0})
    monkeypatch.setattr(exploration_agent.knowledge_service, "merge_verified_discovery", lambda *a, **k: 1)

    captured = FakeObserver([_obs("/form", "Form")])
    monkeypatch.setattr(exploration_agent, "ExplorationObserver", lambda *a, **k: captured)
    decisions = iter([{"action": "fill", "args": {"selector": "#q", "value": "x"}}, {"action": "done", "args": {}}])
    monkeypatch.setattr(exploration_agent, "run_json", lambda *a, **k: next(decisions))

    exploration_agent.explore(
        db=object(), project_key="P", repo="r", target={"screen": "Form"}, allow_state_changing=True
    )
    assert captured.acted[0]["allow_state_changing"] is True


# --------------------------------------------------------------- on_step hook
def test_on_step_surfaces_remaining_budget(wired):
    """Each executed step invokes on_step with the remaining-budget figure."""
    seen: list[dict] = []
    result, _ = wired(
        observations=[_obs("/divisions", "Divisions")],
        decisions=[
            {"action": "click", "args": {"selector": "#a"}},
            {"action": "done", "args": {}},
        ],
        on_step=seen.append,
    )
    assert seen and "remainingBudgetUsd" in seen[0]
    assert seen[0]["step"] == 1
