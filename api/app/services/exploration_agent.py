"""DOM Exploration Agent — the observe→decide→act ReAct loop (#326, ADR 0010 §3-5, 8).

This is the decide layer of the exploration agent. It drives the live application
through the persistent Node browser (:class:`app.services.exploration_observer.ExplorationObserver`,
S1), asking Claude one decision per step, executing the returned fixed-contract
action, and re-observing — until a mandatory stop condition fires. On completion it
merges only the routes/selectors *actually observed* on the running app into the
target repo's Knowledge Base (:func:`app.services.knowledge_service.merge_verified_discovery`,
S2). It never generates tests and it never invents selectors: if the target screen
was never reached, nothing is written and the case stays ``blocked`` (ADR 0010 §8).

The single public entry point is :func:`explore`. The loop is wrapped in
``run_context.set_run(run_id)`` (mirroring :func:`app.services.heal_service.plan_fix`)
so the ambient run scope attributes the per-step Claude spend + credentials to the
run owner — which is also how the per-session cost budget is read back
(:func:`app.services.ai_usage_service.run_breakdown`).

Stop conditions (all mandatory, checked at the TOP of each step before the Claude
call — mirroring ``run_control.is_cancelled`` placement in
:func:`app.services.playwright_runner.heal_spec`):

* **step cap** — ``settings.explore_max_steps`` (hard-clamped to ``<= 20``);
* **cost budget** — this session's spend ``>= settings.explore_cost_budget_usd``;
* **repeat detection** — the current ``(url, accessibility-signature)`` was already
  seen (the agent is stuck / looping);
* **done** — the model emitted the ``done`` action (goal complete).

Real engines only (ADR 0001): tests mock only the observer transport and the
Claude call — there is no simulated browser or LLM.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable

from app.config import settings
from app.logging import logger
from app.services import (
    ai_usage_service,
    knowledge_service,
    project_config_service,
    run_context,
)
from app.services.exploration_observer import (
    ExplorationObserver,
    locator_strategy,
    render_observation,
)
from app.services.claude_cli import run_json
from app.services.skills import AUTOMATION_GENERATOR

# The action contract the model may emit (ADR 0010 §3). ``done`` terminates the
# loop; the rest are executed by the observer (which itself rejects anything
# outside its own allowed set and gates state-changing actions).
_CONTRACT_ACTIONS = frozenset({"goto", "click", "fill", "expectVisible", "done"})

# Absolute ceiling on steps regardless of configuration (ADR 0010 §4).
_MAX_STEPS_HARD_CAP = 20

# Callback invoked once per completed step with the step's progress dict.
OnStep = Callable[[dict[str, Any]], None]


@dataclass
class ExplorationResult:
    """The outcome of one exploration session (ADR 0010 §4-5).

    Attributes:
        discovered: The runtime-observed additions, shaped for
            :func:`knowledge_service.merge_verified_discovery` —
            ``{"routes": [...], "selectors": [...]}``. Empty when the target was
            unreachable.
        log: The ordered exploration log; each entry is
            ``{step, reasoning, action, args, observedUrl}``.
        stop_reason: Why the loop halted — one of ``"done"``, ``"step_cap"``,
            ``"repeat"``, ``"budget"``, ``"unreachable"``.
        steps_taken: Number of actions executed (excludes the terminal ``done``).
        budget_spent: ``{"usd": float, "tokens": int}`` — this session's Claude
            spend, read from the run's usage breakdown.
        wrote_kb: True iff observed data was merged into the Knowledge Base.
    """

    discovered: dict[str, list[dict[str, Any]]]
    log: list[dict[str, Any]]
    stop_reason: str
    steps_taken: int
    budget_spent: dict[str, float]
    wrote_kb: bool = False


def _resolve_base_url(db, project_key: str, repo: str, owner_id: int | None) -> str:
    """Resolve the application base URL for ``(project_key, repo)``.

    Prefers the user-authored project config's base URL (the same source
    :func:`project_config_service.build_context` uses), falling back to the target
    repo's Knowledge Base ``base_url`` when the config has none.

    Args:
        db: Active SQLAlchemy session.
        project_key: The project to explore.
        repo: Target repository name ("" for the legacy project-level KB).
        owner_id: Workspace owner scope (ADR 0009) for the config lookup.

    Returns:
        The base URL, or "" when none is configured (caller treats "" as
        unreachable — there is nothing to drive).
    """
    from app.models.knowledge import ProjectKnowledge, compose_key

    config = project_config_service.get_config_for_owner(db, project_key, owner_id)
    if config is None:
        config = project_config_service.get_config(db, project_key)
    if config and config.base_url:
        return config.base_url

    row = None
    if repo:
        row = (
            db.query(ProjectKnowledge)
            .filter(
                ProjectKnowledge.key == compose_key(project_key, repo),
                ProjectKnowledge.owner_id == owner_id,
            )
            .first()
        )
    if row is None:
        row = (
            db.query(ProjectKnowledge)
            .filter(ProjectKnowledge.key == project_key, ProjectKnowledge.owner_id == owner_id)
            .first()
        )
    return (row.knowledge or {}).get("base_url", "") if row else ""


def _state_signature(obs: dict[str, Any]) -> str:
    """Compute a stable ``(url, accessibility-snapshot)`` signature for repeat detection.

    Two observations that share a URL/path and an equivalent accessibility tree are
    the same page state — if we observe one twice the agent is stuck (ADR 0010 §4).
    The accessibility tree is JSON-serialized with sorted keys and hashed so the
    signature is compact and order-insensitive.

    Args:
        obs: A normalized observation ``{accessibility, elements, url, path}``.

    Returns:
        A short hex signature string.
    """
    loc = obs.get("path") or obs.get("url") or ""
    a11y = json.dumps(obs.get("accessibility"), sort_keys=True, default=str)
    return hashlib.sha1(f"{loc}\n{a11y}".encode("utf-8")).hexdigest()  # noqa: S324 - not security


def _selector_from_args(args: dict[str, Any]) -> tuple[str, str]:
    """Derive the concrete ``(selector, element-label)`` an action's args resolve to.

    Records the identifying value an action *actually used* so a passing action
    yields a runtime-verified selector (paired with :func:`locator_strategy`'s
    strategy). Mirrors the locator priority ``data-testid`` → ``css`` → ``role`` →
    ``label``.

    Args:
        args: The action arguments.

    Returns:
        ``(selector, element_label)``; ``("", "")`` when the args carry no locator.
    """
    test_id = args.get("testId")
    if test_id:
        return f'[data-testid="{test_id}"]', str(test_id)
    selector = args.get("selector")
    if selector:
        return str(selector), str(selector)
    role, name = args.get("role"), args.get("name")
    if role and name:
        return f'role={role}[name="{name}"]', str(name)
    label = args.get("label")
    if label:
        return f"label={label}", str(label)
    return "", ""


def _record_observation(obs: dict[str, Any], routes: dict[str, dict[str, Any]]) -> bool:
    """Record the observed route (path) from one observation.

    Args:
        obs: A normalized observation.
        routes: Accumulator mapping ``path`` → route entry (deduped by path).

    Returns:
        True if the observation carried a usable path (a real, navigated route).
    """
    path = (obs.get("path") or "").strip()
    if not path:
        return False
    routes.setdefault(path, {"path": path, "description": "Observed during exploration"})
    return True


def _record_action_selector(
    args: dict[str, Any],
    screen: str,
    selectors: dict[str, dict[str, Any]],
) -> None:
    """Record the selector a *successful* action used as a runtime-verified selector.

    A selector an action resolved against on the live page is, by definition, real
    (ADR 0010 §3/§5). Stamped with the strategy that worked (:func:`locator_strategy`)
    and deduped by selector value.

    Args:
        args: The successful action's arguments.
        screen: The screen label to attribute the selector to.
        selectors: Accumulator mapping selector value → selector entry.
    """
    selector, element = _selector_from_args(args)
    if not selector or selector in selectors:
        return
    selectors[selector] = {
        "screen": screen,
        "element": element,
        "selector": selector,
        "strategy": locator_strategy(args),
    }


def _build_decide_prompt(
    target: dict[str, Any],
    obs: dict[str, Any],
    log: list[dict[str, Any]],
    *,
    remaining_budget_usd: float,
    steps_left: int,
    allow_state_changing: bool,
) -> str:
    """Build the per-step decide prompt (kept in-file so S3 stays disjoint from S6).

    Carries the goal, the current page representation (:func:`render_observation`),
    the ordered action history, the allowed action set + arg shapes, and the exact
    required output shape. The prompt instructs the model to ground every locator on
    the observed elements (never guess) and to emit ``done`` once the goal is met.

    Args:
        target: The exploration target ``{ticket?, screen?, goal?}``.
        obs: The current normalized observation.
        log: The ordered action history so far.
        remaining_budget_usd: USD left in the session budget (surfaced so the model
            can wrap up before it runs out).
        steps_left: Steps remaining before the step cap.
        allow_state_changing: Whether ``fill`` / submit clicks are permitted this
            session (read-mostly default is False — ADR 0010 §8).

    Returns:
        The prompt string for :func:`claude_cli.run_json`.
    """
    goal = target.get("goal") or target.get("screen") or ""
    screen = target.get("screen") or ""
    ticket = target.get("ticket") or ""

    history_lines = [
        f"  {e['step']}. {e['action']}({json.dumps(e.get('args') or {})}) @ {e.get('observedUrl') or '?'}"
        for e in log
    ]
    history = "\n".join(history_lines) if history_lines else "  (none yet — this is the first step)"

    state_note = (
        "You MAY fill inputs and submit forms this session."
        if allow_state_changing
        else "This is a READ-ONLY session: do NOT fill inputs or submit forms."
    )

    return (
        "You are a DOM exploration agent driving a real web application step by step "
        "to discover the real route and selectors for a target screen. You do NOT "
        "write tests — you navigate and confirm the screen exists.\n\n"
        f"Target ticket: {ticket or '(none)'}\n"
        f"Target screen: {screen or '(unspecified)'}\n"
        f"Goal: {goal or 'Reach and confirm the target screen is rendered.'}\n\n"
        "Current page observation (ground every locator on THESE real elements — "
        "never invent a selector or route):\n"
        f"{render_observation(obs) or '  (no interactable elements observed)'}\n\n"
        "Actions taken so far (do not repeat a step that made no progress):\n"
        f"{history}\n\n"
        f"Budget: {steps_left} step(s) left, ${remaining_budget_usd:.4f} remaining. "
        "Emit `done` as soon as the target screen is confirmed reached.\n\n"
        "Allowed actions (emit exactly ONE per step):\n"
        '  - goto: {"url": "/path"} — navigate to a route.\n'
        '  - click: {"role","name"} OR {"selector"} — click a link/tab/button (navigation).\n'
        '  - fill: {"selector"|"role"|"label", "value"} — type into an input (state-changing).\n'
        '  - expectVisible: {"role","name"} OR {"selector"} — probe that an element is present.\n'
        '  - done: {"summary"} — the goal is complete; stop.\n'
        f"{state_note}\n"
        "Prefer data-testid, then role+name, then label, then css — and only values "
        "present in the observation above.\n\n"
        'Respond with exactly this JSON shape: '
        '{"reasoning": "...", "action": "<one of the above>", "args": { ... }}'
    )


def _parse_decision(raw: Any) -> dict[str, Any] | None:
    """Strictly parse a model decision into ``{reasoning, action, args}``.

    Args:
        raw: The parsed JSON returned by :func:`claude_cli.run_json`.

    Returns:
        The normalized decision, or ``None`` when malformed (unknown/absent action,
        non-dict args) — the caller stops the loop on ``None`` rather than acting on
        garbage.
    """
    if not isinstance(raw, dict):
        return None
    action = raw.get("action")
    if action not in _CONTRACT_ACTIONS:
        return None
    args = raw.get("args")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return None
    return {"reasoning": str(raw.get("reasoning") or ""), "action": action, "args": args}


def _session_spend(db, run_id: int | None) -> dict[str, float]:
    """Read this run's cumulative Claude spend (USD + tokens) via ``ai_usage_service``.

    The loop runs under ``run_context.set_run(run_id)`` so every per-step Claude
    call is stamped with ``run_id``; :func:`ai_usage_service.run_breakdown` sums
    those rows. Best-effort — a read failure reports zero spend (never blocks the
    loop on a bookkeeping error).

    Args:
        db: Active SQLAlchemy session.
        run_id: The run the session's spend is attributed to.

    Returns:
        ``{"usd": float, "tokens": int}`` cumulative spend for the run.
    """
    try:
        bd = ai_usage_service.run_breakdown(db, run_id)
        return {"usd": float(bd.get("totalCostUsd") or 0.0), "tokens": int(bd.get("totalTokens") or 0)}
    except Exception as exc:  # noqa: BLE001 - budget read is best-effort
        logger.warning("Exploration spend read failed for run {}: {}", run_id, exc)
        return {"usd": 0.0, "tokens": 0}


def explore(
    db,
    *,
    project_key: str,
    repo: str,
    target: dict[str, Any],
    run_id: int | None = None,
    case_id: int | None = None,
    owner_id: int | None = None,
    on_step: OnStep | None = None,
    allow_state_changing: bool = False,
) -> ExplorationResult:
    """Drive the live app to discover a target screen's routes/selectors (ADR 0010).

    Runs the observe→decide→act loop until a mandatory stop condition fires, then
    merges only the routes/selectors actually observed on the running app into the
    target repo's Knowledge Base. If the target was never reached (nothing usable
    observed), writes NOTHING and reports ``stop_reason="unreachable"`` — the case
    stays ``blocked``; no selector is ever invented (ADR 0010 §8).

    Args:
        db: Active SQLAlchemy session (used to resolve config/KB and read spend).
        project_key: The project to explore.
        repo: Target repository name ("" for the legacy project-level KB).
        target: What to discover — ``{"ticket": ..., "screen": ..., "goal": ...}``.
        run_id: The run to attribute per-step Claude spend/credentials to (ADR 0010
            §7). ``None`` runs without run attribution (spend still budget-checked).
        case_id: The blocked case that triggered exploration (carried for callers /
            progress; not used by the loop directly).
        owner_id: Workspace owner scope (ADR 0009) for config/KB/auth resolution and
            KB writes.
        on_step: Optional callback invoked once per completed step with a progress
            dict (the step entry plus ``spentUsd``/``remainingBudgetUsd``). S4 wires
            this to the run WebSocket.
        allow_state_changing: When False (default, ADR 0010 §8 read-mostly), the
            observer refuses ``fill`` / submit clicks.

    Returns:
        An :class:`ExplorationResult` with the discovered additions, the ordered
        exploration log, the stop reason, steps taken, spend, and whether the KB was
        written.
    """
    previous_run = run_context.get_run()
    if run_id is not None:
        run_context.set_run(run_id)
    try:
        return _explore(
            db,
            project_key=project_key,
            repo=repo,
            target=target,
            run_id=run_id,
            owner_id=owner_id,
            on_step=on_step,
            allow_state_changing=allow_state_changing,
        )
    finally:
        if run_id is not None:
            run_context.set_run(previous_run)


def _explore(
    db,
    *,
    project_key: str,
    repo: str,
    target: dict[str, Any],
    run_id: int | None,
    owner_id: int | None,
    on_step: OnStep | None,
    allow_state_changing: bool,
) -> ExplorationResult:
    """The exploration loop proper (see :func:`explore`; runs inside the run scope)."""
    max_steps = max(1, min(int(settings.explore_max_steps), _MAX_STEPS_HARD_CAP))
    budget_usd = float(settings.explore_cost_budget_usd)
    screen = target.get("screen") or (repo or project_key) or "screen"

    routes: dict[str, dict[str, Any]] = {}
    selectors: dict[str, dict[str, Any]] = {}
    log: list[dict[str, Any]] = []
    seen_states: set[str] = set()

    baseline = _session_spend(db, run_id)["usd"]
    spent_usd = 0.0
    spent_tokens = 0

    base_url = _resolve_base_url(db, project_key, repo, owner_id)
    if not base_url:
        logger.info(
            "Exploration: no base URL for {} / {} — nothing to drive (unreachable)",
            project_key, repo,
        )
        return ExplorationResult(
            discovered={"routes": [], "selectors": []},
            log=[],
            stop_reason="unreachable",
            steps_taken=0,
            budget_spent={"usd": 0.0, "tokens": 0},
            wrote_kb=False,
        )

    stop_reason: str | None = None
    steps_taken = 0

    with ExplorationObserver(
        base_url, project_key=project_key, owner_id=owner_id
    ) as observer:
        while True:
            # --- Stop conditions, checked at the TOP before any Claude call ---
            if steps_taken >= max_steps:
                stop_reason = "step_cap"
                break

            spend = _session_spend(db, run_id)
            spent_usd = spend["usd"] - baseline
            spent_tokens = spend["tokens"]
            remaining = budget_usd - spent_usd
            if spent_usd >= budget_usd:
                stop_reason = "budget"
                break

            obs = observer.observe()
            _record_observation(obs, routes)

            signature = _state_signature(obs)
            if signature in seen_states:
                stop_reason = "repeat"
                break
            seen_states.add(signature)

            # --- Decide (one Claude call) ---
            prompt = _build_decide_prompt(
                target,
                obs,
                log,
                remaining_budget_usd=remaining,
                steps_left=max_steps - steps_taken,
                allow_state_changing=allow_state_changing,
            )
            raw = run_json(prompt, skill=AUTOMATION_GENERATOR, label=f"Explore: {screen}")
            decision = _parse_decision(raw)
            if decision is None:
                logger.warning("Exploration: malformed decision, stopping: {!r}", raw)
                break

            action = decision["action"]
            args = decision["args"]
            observed_url = obs.get("url") or obs.get("path") or ""

            if action == "done":
                stop_reason = "done"
                entry = {
                    "step": steps_taken + 1,
                    "reasoning": decision["reasoning"],
                    "action": "done",
                    "args": args,
                    "observedUrl": observed_url,
                }
                log.append(entry)
                if on_step:
                    on_step({**entry, "spentUsd": spent_usd, "remainingBudgetUsd": remaining})
                break

            # --- Act ---
            result = observer.act(
                {"action": action, "args": args}, allow_state_changing=allow_state_changing
            )
            if result.get("ok"):
                _record_action_selector(args, screen, selectors)

            steps_taken += 1
            entry = {
                "step": steps_taken,
                "reasoning": decision["reasoning"],
                "action": action,
                "args": args,
                "observedUrl": observed_url,
            }
            log.append(entry)
            if on_step:
                on_step(
                    {
                        **entry,
                        "ok": bool(result.get("ok")),
                        "spentUsd": spent_usd,
                        "remainingBudgetUsd": remaining,
                    }
                )

    discovered = {"routes": list(routes.values()), "selectors": list(selectors.values())}
    spent = {"usd": round(spent_usd, 6), "tokens": spent_tokens}

    # Never invent (ADR 0010 §8): with no usable observation of the target we write
    # NOTHING (the case stays blocked). An explicit early halt keeps its reason; a
    # loop that "finished" (done) or ran out without a terminal reason but observed
    # nothing usable is reported honestly as an unreachable target.
    if not discovered["routes"] and not discovered["selectors"]:
        reason = stop_reason if stop_reason in ("step_cap", "repeat", "budget") else "unreachable"
        return ExplorationResult(
            discovered={"routes": [], "selectors": []},
            log=log,
            stop_reason=reason,
            steps_taken=steps_taken,
            budget_spent=spent,
            wrote_kb=False,
        )

    if stop_reason is None:
        stop_reason = "step_cap"  # loop ended without an explicit terminal reason

    merged = knowledge_service.merge_verified_discovery(
        project_key, repo, discovered, owner_id=owner_id, source="exploration"
    )
    return ExplorationResult(
        discovered=discovered,
        log=log,
        stop_reason=stop_reason,
        steps_taken=steps_taken,
        budget_spent=spent,
        wrote_kb=merged > 0,
    )
