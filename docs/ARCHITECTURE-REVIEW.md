# Q-Agent — Technical Architect Review

_Date: 2026-07-12 · Scope: AI processing via Claude CLI, test-case & test-script
generation quality, and overall architecture / performance / flow / process._

> Method: read-only audit of `api/` (18.4k LOC Python) and `app/` (21.6k LOC
> TS/React), the 9 ADRs, and the `skills/` directory. Every claim is anchored to
> `file:line`. Findings are ranked by ROI, not by where they appear in the code.

---

## 0. Executive verdict

Q-Agent is well-architected for a local-first MVP. The Claude CLI integration is
clean, cancellation is genuinely well-designed, and the run state machine has a
correct terminal-guard invariant. **The highest-value issues are not
infrastructure — they are (a) a set of _prompt/skill contradictions_ that make
generated test-case quality nondeterministic, (b) two fully-authored AI stages
that are wired to nothing, and (c) the AI pipeline being strictly sequential with
no crash recovery.**

Two things people often reach for are **not** worth doing here:

- **Redis** — negative ROI. The app is deliberately single-process; the
  bottleneck is Claude CLI wall-time (10–100 s/call), not lookups. See §2.4.
- **"Fix" the prompt-cache ordering** — it's already correct. See §2.1.

| Priority | Theme | Payoff |
|----------|-------|--------|
| **P0** | Resolve test-case-generator skill ↔ prompt contradiction; wire or delete the orphaned reviewer stages | Consistency + real edge/negative coverage |
| **P0** | Verify Claude usage/cost capture is not silently recording zeros | Trust in the cost dashboard |
| **P1** | Merge analyze+generate into one CLI call; add per-action model selection | ~50 % fewer calls + tier-cost savings |
| **P1** | Boot-time recovery for runs stuck in non-terminal status | No permanently-hung runs |
| **P1** | Close JSON contract gap (Objective, Test Data, Linked AC, Coverage Matrix) | AC→case traceability |
| **P2** | Bounded per-ticket parallelism (Postgres only); per-run context memoization; KB relevance-selection | Latency on multi-ticket runs |

---

## 1. How AI processing works today

Every AI action is a fresh subprocess:

```
claude -p "<user prompt>" --append-system-prompt "<SKILL.md [+ system]>" \
       --output-format json --model <global model>
```

`api/app/services/claude_cli.py:199-209`. In JSON mode the CLI returns an
envelope whose `result` field carries the assistant text; `run_json` asks for a
single JSON value and parses it (`claude_cli.py:319-348`).

A run's generation pipeline (`ai_service._run_pipeline`,
`ai_service.py:247-290`) loops over each `RunTicket` **sequentially** and makes
**two** CLI calls per ticket:

1. **Analyze** — `requirement-analyst` skill → analysis JSON (`ai_service.py:154`)
2. **Generate** — `test-case-generator` skill → test-case JSON array (`ai_service.py:181`)

It runs in a raw `threading.Thread` (`ai_service.py:293-306`) with its own DB
session. Credentials are resolved per-call and materialized into a private
`CLAUDE_CONFIG_DIR` (`claude_cli.py:116-142`). Cancellation registers the live
subprocess so a run-cancel kills it immediately (`claude_cli.py:228-263`,
`run_control.py`).

### Already optimal — do **not** touch

- **Prompt-cache prefix ordering.** The cacheable prefix is Claude Code's own
  system prompt + the appended `SKILL.md`; `_compose_system` injects _only_ the
  (lru-cached) skill text (`claude_cli.py:63-72`, `skills.py:46`). Per-ticket
  content lives in the user prompt, stable-first (project block → repo options →
  ticket, `prompts.py:145-170`). Nothing per-ticket leaks into the cached prefix.
- **Cancellation** — `register_process` + post-cancel kill guard + DB-fallback
  `is_cancelled` is a solid belt-and-suspenders design.
- **Usage-row isolation** — `ai_usage_service.record` uses its own short-lived
  session and never throws into the call path.
- **Single-case regenerate reuses stored analysis** — doesn't re-analyze
  (`ai_service.py:329`).

---

## 2. AI process — optimization opportunities (ranked by ROI)

### 2.1 Prompt caching is structurally sound but **unverified** — P0 to confirm

The plumbing is right: `cache_read_input_tokens` / `cache_creation_input_tokens`
are parsed from the envelope (`claude_cli.py:97-98`), persisted
(`models/claude_usage.py:31-32`) and surfaced in `/ai/stats`. **But the only
real usage rows on disk show zeros for every token/cost/duration field**, and
`duration_ms` always falls back to measured wall time (`claude_cli.py:100`) — so
nobody has confirmed the current CLI version's envelope actually populates
`usage`. If a newer CLI nests usage differently (e.g. `modelUsage`),
`_record_usage` silently records zeros and the entire cost dashboard is fiction.

- **Action:** one instrumented run; log the raw envelope keys once; add a
  fallback for alternate shapes. **Effort: trivial. Risk: none.** This is a
  prerequisite for measuring every other optimization below.
- **Inherent limit (not a bug):** headless `-p` mode starts a fresh session each
  call, so only the system+tools prefix scores cache reads (within the 5-min
  TTL — consecutive pipeline calls qualify). The ~1–3 KB knowledge-base block
  sits in the _user_ prompt and is re-billed at full input price every call; the
  CLI gives no way to put a `cache_control` breakpoint there.

### 2.2 Merge analyze + generate into one call — P1, biggest cost lever

Currently 2 sequential calls per ticket, the second embedding the first's JSON
verbatim (`prompts.py:201`). Each call pays full fixed overhead: process spawn,
credential materialization, and Claude Code's whole system prompt + tool
definitions (~10–20 K input tokens), plus the KB block **twice**.

- **Change:** one combined prompt returning `{"analysis": {...}, "cases": [...]}`.
- **Payoff:** ~50 % fewer CLI calls in the hot path → roughly halves per-ticket
  wall-time and fixed-overhead token spend.
- **Effort: medium. Risk: low–medium** (loses the mid-ticket cancel checkpoint at
  `ai_service.py:171`, but `register_process` still kills in-flight calls).

### 2.3 Per-action model selection — P1, low effort

One global model for everything (`_resolve_model`, `claude_cli.py:37-46`).
Failure classification (`failure_classifier.py`), screenshot annotation and
requirement analysis are small structured-JSON tasks paying the same rate as
spec generation.

- **Change:** optional `model` param on `run_prompt`/`run_json` + a per-action
  map in settings (e.g. Haiku for classify/analyze, Sonnet/Opus for
  generate/automation). Model IDs: `claude-haiku-4-5-20251001`,
  `claude-sonnet-5`, `claude-opus-4-8`.
- **Payoff:** tier pricing differs ~3–5×; also faster heal loops (classification
  runs up to 3× per heal). **Effort: low. Risk: low** (keep configurable).

### 2.4 Redis / external cache — **recommend against**

The app is deliberately single-process: cancellation events + live subprocess
handles (`run_control.py`), in-flight KB builds (`knowledge_service.py`) and heal
state (`playwright_runner.py`) are all in-memory dicts/sets. Adding Redis for
caching while correctness state stays in-process buys nothing; going multi-process
would first require moving _those registries_ out — a far bigger change than any
cache. Every cache candidate here (per-run knowledge context, per-run
`list_test_cases`, `is_available()`) is solved by a plain dict / `lru_cache`
inside the process. **ROI of Redis: negative** (new container, new failure mode,
zero latency win).

### 2.5 Bounded per-ticket parallelism — P2, Postgres only

The ticket loop (`ai_service.py:265-272`) is strictly sequential; tickets are
data-disjoint (each writes only its own rows), so 2–3-wide concurrency is
feasible. **Guardrails required:**

- **Per-worker DB sessions** — today one session is shared into
  `_process_run_ticket` (`ai_service.py:251,272`); not thread-safe.
- **SQLite locking** — the engine sets no WAL / `busy_timeout` (`db.py:23-27`);
  concurrent writers hit "database is locked". Fine on the bundled Postgres, so
  **gate parallelism on Postgres** (or enable WAL + busy_timeout for SQLite).
- **Rate limits** — all calls run under one user's subscription OAuth credential;
  parallel calls burn the shared 5h/weekly window faster and can 429. Keep the
  bound low and configurable. Also all threads share one materialized
  `CLAUDE_CONFIG_DIR` — concurrent token refresh (`claude_cli.py:163-177`) can
  race; serialize `persist_refreshed`.

### 2.6 Smaller wins

- **Per-run memoization** — `context_for_ticket` is rebuilt per ticket
  (`ai_service.py:144`, ~6 DB queries + Fernet decrypts each) and
  `provider_case_offset` is **one remote ADO/Jira round-trip per ticket**
  (`ai_service.py:179`). All tickets share the project/env → build context once
  per (run, repo); fetch offsets once per run. Saves seconds/ticket (no token
  saving). **Effort: low.**
- **"Regenerate cases only" mode** — `POST /runs/{id}/regenerate` reruns _both_
  phases (`runs.py:340-356`); add a flag to keep `run_ticket.analysis` when the
  ticket is unchanged. Halves a common operator action.
- **Cache `is_available()`** — every `/ai/stats` poll spawns `claude --version`
  (15 s timeout). Memoize ~60 s.

---

## 3. Test-case & test-script generation quality

This is where the largest _quality_ (as opposed to cost) wins are. The recurring
defect pattern: **the skill (system prompt) and the Python prompt builder evolved
independently**, and two review stages were built but never wired in.

### 3.1 P0 — `test-case-generator` skill contradicts its own prompt

- **System prompt** (`skills/test-case-generator/SKILL.md:84-96`, v2.0.0): produce
  **happy-path only**; "Do NOT proactively generate invalid input / boundary /
  error handling … Those belong to `test-case-reviewer`."
- **User prompt** (`prompts.py:194-196, 204-206`): "give good coverage of the
  acceptance criteria, business rules, **and edge cases**", and explicitly offers
  `testType` = Negative / Boundary / Security.

Claude gets directly conflicting instructions in the same call. Because the skill
is the _system_ prompt framed as authoritative, coverage depth becomes a
per-call coin flip — **exactly the "sometimes 8 rich cases, sometimes 3 thin
ones" nondeterminism** users report.

- **Fix (pick one intent):** either restore the exhaustive v1 (content preserved
  in `SKILL_BACKUP.md`) as `SKILL.md` and delete the backup, **or** keep v2 and
  rewrite `build_generation_prompt` to "happy-path per AC only". Then §3.2.

### 3.2 P0 — `test-case-reviewer` and `automation-reviewer` are orphaned

`TEST_CASE_REVIEWER` (`skills.py:23`) and `AUTOMATION_REVIEWER` (`skills.py:25`)
are registered but have **zero call sites** anywhere in `api/`. The pipeline goes
analyze → generate → `set_run_status(run, "review")` (`ai_service.py:274`) — and
that "review" is the **human** review screen, not an AI stage.

**Consequence:** under the v2 "defer edge cases to the reviewer" design, the
deferred coverage happens _nowhere_. The pipeline structurally produces
happy-path-only suites and the promised edge/negative expansion never runs. Worse,
requirement-analyst already extracts `edgeCases` and feeds them into the
generation prompt via the analysis dict — so the pipeline **pays to find edge
cases, then instructs the next stage to ignore them.**

- **Fix:** add a real AI reviewer stage in `_run_pipeline` after generation
  (`run_json(build_review_prompt(...), skill=TEST_CASE_REVIEWER)` returning
  additional cases + a coverage-gap report, persisted on `RunTicket` and shown on
  the review screen) — or delete the dead skills. Same choice applies to
  `automation-reviewer` (see §3.5).
- **Guardrail:** add a startup assertion / CI test that every skill in `SKILLS`
  has ≥1 call site, to prevent this class of regression.

### 3.3 P1 — JSON contract drops half of what the skill mandates

The skill asks for per-case **Objective, Test Data, Linked Acceptance Criteria**
and a **Requirement Coverage Matrix** (`SKILL.md:115-137`). But
`CASES_JSON_SHAPE` (`prompts.py:26-36`) and the `TestCase` model
(`models/testcase.py:27-34`) carry only `title, precondition, steps[{a,e}],
priority, testType, automation, platform`.

Dropped: **Objective, Test Data, Linked AC, Coverage Matrix.** Consequences:
(1) no AC→case traceability, so no one can verify every AC is covered; (2)
concrete test data gets stuffed into free-text steps, hurting manual execution
and downstream spec generation; (3) the model is asked to produce a coverage
matrix that is _unrepresentable_ in the required JSON, so it silently discards it
(more instruction dissonance).

- **Fix:** add `"objective"`, `"testData": [{field, value}]`, `"linkedAc":
  string[]` to the shape + model; persist the coverage matrix on `RunTicket`
  (JSON column) beside `analysis`.

### 3.4 P2 — single-case regenerate loses all project grounding

`build_case_regenerate_prompt` (`prompts.py:216-234`) takes **no project
context**, unlike generation. Regenerated cases drift into invented
routes/roles — strictly _lower_ quality than the originals. Thread `context`
through like `build_generation_prompt` does.

### 3.5 Test-script (Playwright) generation — solid machinery, one core contradiction

The automation path is materially better engineered than test-case generation:

- **Real KB flow** — `spec_service.build_case_context` + `_build_prompt` render
  routes, selectors, auth/`storageState`, PO/fixture names and **literal test
  credentials** into the prompt (`spec_service.py:77-151`,
  `render_project_context(..., include_secrets=True)`).
- **Few-shot from green** — up to 2 specs that _passed at runtime_, same
  project+repo, relevance-ranked (`spec_examples.py:91-149`).
- **Two static gates** — placeholder/invented-ref regex + `playwright test --list`
  parse; a rejected spec never overwrites a good one (`automation.py:147-195`).
- **Real self-heal loop** — run → classify failure (product defects are terminal,
  never "healed") → regenerate with error tail + context + examples →
  **anti-cheat**: a fix that lowers assertion count is rejected → re-gate → re-run,
  up to `heal_max_attempts` (`playwright_runner.py:923-1180`).

Problems, ranked:

1. **P1 — prompt contradicts the automation skill.** `automation-generator/SKILL.md`
   demands reusing/extending Page Objects & fixtures and following
   `templates/playwright-spec.ts`; but `_build_prompt` (`spec_service.py:148-151`)
   _forces_ a single inline `test(async ({ page }) => …)` with raw `page`, and the
   KB supplies PO/fixture **names only** — so reuse is impossible even if asked.
   Fix: either rewrite the skill to the real standalone-spec model (and promote
   the robust fix-prompt language from `spec_service.py:198-203` into the
   _generation_ prompt, which currently lacks it), or enrich the KB with PO
   method signatures so specs can import them.
2. **P1 — `automation-reviewer` orphaned** (same as §3.2). Cheap deterministic
   wins can land even without Claude: extend `placeholder_gate` to flag
   `waitForTimeout(`, zero-`expect` specs, and brittle raw-CSS locators — caught
   _before_ paying a run+heal cycle.
3. **P2 — KB truncation is arbitrary, not relevant.** `render_project_context`
   hard-slices `routes[:20]` / `selectors[:30]` (`prompts.py:93,100`). A project
   with 80 selectors always gets the first 30 — the one the test needs may be cut,
   forcing invention (which the gate then rejects: wasted round-trips). Reuse the
   `spec_examples._keywords` machinery to rank KB entries against the case
   title+steps and inject the top-N.
4. **P2 — no KB feedback from heals.** When a heal fixes a broken selector and the
   spec passes, the corrected selector is not written back to the KB, so every
   future generation can re-make the same mistake. (Partially mitigated: the
   passed spec becomes a few-shot example.)
5. **Minor — traceability + filename collision.** No Test Case ID in the `test()`
   title (skill mandates it, `SKILL.md:71-73`); `spec_filename` keeps only the last
   `-` segment of the ticket, so `SUR-142/TC-01` and `OPS-142/TC-01` collide in one
   run (`spec_service.py:283-295`). Inject `templates/playwright-spec.ts` via
   `include_template=True` for `AUTOMATION_GENERATOR` (output is code, no JSON
   conflict).

> Note: `load_skill` is `@lru_cache`d (`skills.py:46`) — **skill edits require an
> API restart** to take effect. Worth a comment so edits don't silently no-op.

---

## 4. Architecture / flow / process

### 4.1 Background work has no crash recovery — P1

The AI pipeline (and execution) run in bare `threading.Thread`s
(`ai_service.py:293-306`). There is a well-designed _manual_ retry path (ADR
0005: `runs.py:400-445`, a `failed_stage → resume_stage` dispatch table) — but it
only fires when a user clicks retry on a **terminal** run.

**Gap:** if the process dies mid-`processing`/`executing`, the run stays in a
_non-terminal_ status forever, with no worker behind it and no boot-time sweep to
detect it. Nothing in `main.py`/`init_db` reconciles orphaned in-flight runs.

- **Fix:** on startup, sweep runs in non-terminal statuses with no live worker and
  either mark them `failed` (so the existing retry path applies) or auto-resume via
  the ADR-0005 dispatch table. **Effort: low. Impact: high** (no permanently-hung
  runs after a restart/crash/deploy). This is the main thing standing between the
  current threading model and needing a real job queue — and it's cheaper than a
  queue.

### 4.2 Run state machine — solid

`set_run_status` is the single transition point with a terminal-guard invariant:
a worker that finishes a stage _after_ a cancel/failure can never resurrect the
run (`run_status.py:20-47`, ADR 0005). `force_status` is the one intentional
bypass (retry). This is clean; keep it.

### 4.3 WebSocket hub — fine for progress, no replay

`ProgressHub` fans events to per-run subscribers and hops threads via
`run_coroutine_threadsafe` (`ws.py:49-57`). It's fire-and-forget: no
backpressure, no missed-event replay. Acceptable because the frontend refetches
authoritative state over REST/TanStack Query on (re)connect — but document that
WS is _cosmetic/live-progress only_ and REST is the source of truth. Note the
three analysis "phase" events are published _before_ the analysis call even runs
(`ai_service.py:146-152`) — the progress bar is decorative, not real streaming.

### 4.4 DB & concurrency

`check_same_thread=False` for SQLite cross-thread use (`db.py:15-20`); Postgres in
compose. Alembic-based migrations with a smart pre-Alembic adoption stamp
(`db.py:73-106`) — good. **Watch item:** the SQLite engine sets no WAL /
busy_timeout, which is the hard blocker for §2.5 parallelism on the local default.

### 4.5 Frontend — healthy, watch the god-screens

URL-as-source-of-truth routing (ADR 0003/0004) with UI-only state in Zustand and
server state in TanStack Query. Two screens are large enough to watch for
re-render / maintainability cost: `Automation.tsx` (1340 LOC) and
`ProjectDetail.tsx` (1330 LOC) — candidates for decomposition. The Three.js
neural background + Framer Motion are the main bundle/runtime cost; confirm the
background is memoized and paused when off-screen.

### 4.6 Process / tests / security

- **Backend tests** (~113, `api/tests/`) cover adapters (mocked HTTP), AI/automation
  via mocked engines, config, encryption, publish. **Not covered:** the threaded
  pipeline's concurrency/recovery behavior, WebSocket delivery, and (per CLAUDE.md)
  the **frontend has no unit tests** — the gate is typecheck + build only.
- **Secrets** — Fernet-at-rest for provider creds + test-account passwords,
  per-user Claude credentials materialized into private config dirs (ADR
  0008/0009). Solid. Keep `QAGENT_SECRET_KEY` out of git (it is) and rotate the
  dev default before real use.
- **N+1 / remote calls in loops** — `provider_case_offset` per ticket (§2.6) is the
  clearest one; batch/memoize per run.

---

## 5. Recommended sequencing

1. **P0, this week (cheap, high trust):** verify usage capture (§2.1); resolve the
   test-case skill↔prompt contradiction and decide reviewer-stage fate (§3.1–3.2).
2. **P1:** merge analyze+generate (§2.2) + per-action models (§2.3); boot-time run
   recovery (§4.1); JSON contract fields + coverage matrix (§3.3); align the
   automation prompt with an achievable spec architecture (§3.5.1).
3. **P2:** bounded parallelism on Postgres (§2.5); per-run context/offset
   memoization (§2.6); KB relevance-selection + heal→KB feedback (§3.5.3–3.5.4);
   decompose the two god-screens (§4.5).

**Cross-cutting:** add a CI check that every registered skill has a call site and
co-locate each prompt builder's coverage wording with its skill — the root cause of
the biggest quality issues here was skills and prompts drifting apart unnoticed.
