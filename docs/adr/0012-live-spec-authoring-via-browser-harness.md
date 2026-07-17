# ADR 0012 — Live spec-authoring via browser-harness

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Client, Q-Agent build
- **Supersedes (in part):** [ADR 0010](0010-dom-exploration-agent-kb-enrichment.md)
  — its "exploration enriches the KB but does **not** author tests" stance is
  reversed *for this optional mode only*.
- **Extends:** [ADR 0001](0001-scope-architecture-and-live-integrations.md) (real
  engines), [ADR 0002](0002-project-knowledge-config-and-multi-repo.md) (per-repo KB)

## Context

Q-Agent authors automation **blind**: `automation-generator` writes a Playwright
`.spec.ts` from the Knowledge Base alone (no live browser), and only *after* it
fails does the self-heal loop (ADR 0010's neighbour) reactively hunt for the real
selectors — info-starved, and it can still end `blocked`. The LLM effort is spent
at the worst moment.

ADR 0010 deliberately kept exploration and authoring separate ("a full autonomous
test-writer was rejected to keep generated specs reproducible"). Since then the
`browser-harness` CLI (an LLM-native CDP browser controller) became available on
the host, and the client validated it by hand against the real target app. This
ADR adds an **opt-in authoring mode** that inverts the flow: drive the real app
first, discover real selectors on the live DOM, then emit the spec — paying the
live-browser + LLM cost once, at authoring time, where there is ground truth.

## Decision

### 1. New mode, additive and gated

A new workspace setting **`authoringMode`** (`"blind"` default | `"live-harness"`)
selects the path, orthogonal to `executionTarget`. Blind generation + heal stays
the default and the fallback; live-authoring is proven on real tickets before the
default is ever flipped. The dispatch branch lives in `_generate_one`
(`routers/automation.py`) — the *only* difference is where the spec `code` comes
from; the existing gate → `playwright_list_ok` → `write_spec_file` → persist
`AutomationSpec` pipeline is shared unchanged.

### 2. Engine — browser-harness, driven by an agentic Claude

Claude itself drives the `browser-harness` CLI (using its full interaction-skills
for hard widgets). This required the **first tool-enabled Claude invocation** in
Q-Agent: `claude_cli.run_agentic` adds `--allowedTools Bash Read Write Glob Grep`,
`--dangerously-skip-permissions` (headless `-p` has no TTY to approve prompts),
`--add-dir`/`cwd` confinement, and `--max-budget-usd`. It reuses the same
`--output-format json` envelope, so usage/cost recording is unchanged. Existing
single-shot callers (`run_prompt`/`run_json`) are untouched — the tool flags are
opt-in params defaulting to off.

### 3. Runs server-side; browser-harness attaches to a dedicated Chrome

Live-authoring always runs on the API host (the "treat the host as a server"
model) — no paired-device bridge. A long-lived launcher
(`pw_scripts/authoring_browser.cjs`) starts a **dedicated, pre-authenticated
Chrome** on a fixed `--remote-debugging-port` with a persistent, non-default
`--user-data-dir` (a dedicated profile deliberately avoids Chrome's "Allow remote
debugging" popup — see `browser_harness/daemon.py`). The service points
browser-harness at it with **`BU_CDP_URL=http://127.0.0.1:<port>`**. Auth is
inherited from the persistent profile: it reuses the capture `browser-profile`
already logged in via the manual-login flow, so no session injection is needed.
The launcher is torn down (Chrome killed) in `finally` via stdin-close — a
cross-platform signal that works on Windows.

### 4. Output contract preserved; KB enriched

The `live-authoring` skill emits the **same** contract as `automation-generator`
(single self-contained `*.spec.ts`, only `@playwright/test`, one `test()` titled
with the TC id, web-first assertions, no hard waits, no auth mocking, locator
priority `data-testid`→role→label→css) — plus a `discovered.json` sidecar of the
runtime-verified routes/selectors it actually used. Those are merged into the KB
via `merge_verified_discovery` (`source="live-authoring"`, no-clobber, stamped
`verified_at_runtime`) and folded into the gate's `known` set so the just-verified
selectors are never flagged as invented.

### 5. Create test data if missing

The skill instructs Claude to **create any test data the case depends on** through
the UI if it is not present, and to bake the created values into the emitted spec
so it re-runs self-sufficiently — never depending on data that merely happens to
exist today, and never mutating data it did not create.

### 6. Bounded — cost + time

An autonomous tool-using run is bounded by a per-session Claude **cost ceiling**
(`authoring_cost_budget_usd`, enforced both by a pre-start check and natively via
the CLI's `--max-budget-usd`) and a wall-clock **timeout** (`authoring_timeout_s`).

## Consequences

**Positive:** specs are authored from live, runtime-verified selectors, so they
should run green with no heal; the KB is enriched as a side effect; blind mode is
untouched and remains the safe default.

**Negative / risks:**
- **Security posture** — a Bash-enabled server-side Claude gets the host env.
  Mitigated by a dedicated entry point, a tight tool allowlist, workspace
  confinement, mode-gating, and test-env/test-account-only use. Never point it at
  production.
- **Host prerequisite** — the API host must have `browser-harness` on PATH and a
  launchable Chrome/Edge with network to the app under test (surfaced by a
  preflight). If the API is containerized, provision these in the image.
- **Auth prerequisite** — requires a pre-authenticated dedicated `browser-profile`
  (established once via manual-login capture). `sessionStorage`-only auth is not
  yet replayed into the CDP Chrome; most apps re-hydrate it from the profile's
  cookies. If a target needs explicit `sessionStorage` replay, that is a follow-up.
- **Cost/latency** — an agentic per-step run is slower/pricier than blind
  generation, bounded by the three limits above; acceptable because it replaces
  heal cost and is authoring-time-only.
