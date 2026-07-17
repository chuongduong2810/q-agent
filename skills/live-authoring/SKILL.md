---
name: live-authoring
description: Author a runnable Playwright + TypeScript spec by FIRST driving the real app live with the browser-harness CLI — performing the test case's steps against a real browser, discovering the real selectors on the live DOM, creating any missing test data — and only then emitting a self-contained spec built from what actually worked. Use for the live-authoring execution mode (#400), instead of generating a spec blind and healing it afterwards.
version: 1.0.0
---

# Live Authoring

## Purpose

Produce a single, runnable, self-contained Playwright + TypeScript spec for **one approved manual
test case** — but instead of writing it blind from the Knowledge Base and healing the failures,
**drive the real application first** with the `browser-harness` CLI: actually perform each step
against a live browser, discover the *real* selectors on the *real* DOM, create any test data the
case needs, confirm each expected result — and only then emit the spec, built from exactly what
worked. The result is a clean, deterministic Playwright spec grounded in runtime-verified selectors,
so it should run green with no heal pass.

## How you drive the browser

A dedicated, already-authenticated Chrome is running and `browser-harness` is pre-wired to it (the
`BU_CDP_URL` environment variable points at it — you do **not** configure any connection, open
`chrome://inspect`, start a daemon, or pick a profile). Just run the CLI with a heredoc:

```bash
browser-harness <<'PY'
new_tab("<base URL from context>")
wait_for_load()
print(page_info())
PY
```

- Helpers are pre-imported. First navigation is `new_tab(url)` (not `goto_url`). After navigation call `wait_for_load()`; if the tab is stale/internal call `ensure_real_tab()`.
- **Find elements via the accessibility tree, then verify** — do not guess. `cdp("Accessibility.getFullAXTree")["nodes"]` has every element's `role`, `name`, and `backendDOMNodeId` (filter in Python before printing — it is large). To click: resolve the box center and `click_at_xy(x, y)`, then confirm with a targeted `js(...)` / `page_info()` check. Use `js(...)` for DOM inspection/extraction (e.g. read a `data-testid`, an input's label, the visible text of a result).
- The Chrome is already signed in via its persistent profile. If you unexpectedly hit a login wall, use available SSO if Chrome is already signed in; **never** type passwords/MFA yourself, and **never** run against a production environment.

## Record the REAL selector for every interaction

This is the whole point. As you perform each step, capture the concrete, stable selector that
actually located the element on the live page — you will bake these exact selectors into the spec.
For each element you interact with or assert on, determine and record the **highest-priority stable
selector that exists on the live DOM**, in this order:

1. `data-testid` (or `data-test`) → Playwright `getByTestId('…')` / `[data-testid="…"]` — **strategy `data-testid`**
2. ARIA role + accessible name → `getByRole('button', { name: '…' })` — **strategy `role`**
3. Associated label → `getByLabel('…')` — **strategy `label`**
4. A stable CSS selector (id, unique attribute) — **strategy `css`** (last resort; never `:nth-child`, bare classes, or DOM-structure combinators)

Read the element's real attributes live (via `js(...)` or the AX tree) to choose — do not assume a
`data-testid` exists; confirm it does before using it.

## Create test data if it does not exist

If a step depends on data that is not present (e.g. the case acts on "an existing draft claim" and
there is none, or needs a named record that isn't there), **create it live through the UI first**,
then continue. Record the exact values you created (names, ids, field values). Bake those created
values (and the setup actions) into the emitted spec — via a setup section at the top of the
`test()` (or a `test.beforeAll` / creation steps) — so the spec is **self-sufficient on re-run** and
does not silently depend on data that happens to exist today. Prefer values that are safe to
re-create idempotently (e.g. a unique suffix) where the app allows it. Never mutate or delete data
you did not create.

## Emit the spec — same contract as automation-generator

After every step and expected result has been confirmed live, **write two files into the current
working directory** (the paths are given to you in the task prompt):

1. **The spec** — a single self-contained `*.spec.ts` following `templates/playwright-spec.ts`:
   - `import { test, expect } from '@playwright/test';` — **no other imports** (no Page Objects,
     fixtures, or helper modules; they do not exist in this file's directory).
   - **One `test()`**, its title prefixed with the **Test Case ID** (e.g.
     `test('TC-01 — …', async ({ page }) => { … })`) so results trace back.
   - Inline login using the real login URL/flow + the real test-account credentials from the
     injected context. **Never mock or bypass auth** — no route-mocking of identity/session
     endpoints, no `VITE_BYPASS_AUTH`, no fabricated `storageState`, no "Auth note" prose.
   - Use the **real selectors you verified live** (with the strategy priority above). Bake in the
     real base URL, routes, and any test data you created.
   - Every "Expected Result" becomes a **web-first assertion** (`await expect(locator).toBeVisible()`,
     `.toHaveText(…)`, `.toHaveURL(…)`) — rely on auto-waiting. **No `page.waitForTimeout(...)`** or
     any hard sleep. Deterministic and independent — no shared mutable state.

2. **The discovery sidecar** — a JSON file with exactly this shape, listing the runtime-verified
   routes and selectors you actually used, so they can be merged into the Knowledge Base:

```json
{
  "routes": [{ "path": "/claims/new", "description": "New claim form" }],
  "selectors": [
    { "screen": "New claim", "element": "Submit button", "selector": "getByRole('button', { name: 'Submit' })", "strategy": "role" },
    { "screen": "New claim", "element": "Amount field", "selector": "[data-testid=\"amount\"]", "strategy": "data-testid" }
  ]
}
```

## Final output

After writing both files, respond with a short plain-text summary: which steps you performed, any
test data you created, and the pass/fail of each expected result. If you could **not** make the test
pass live (e.g. a genuine product defect, or a step is impossible), do not fabricate a passing spec —
say so clearly in the summary and still write the discovery sidecar with whatever you verified.

## Quality rules (carry over from automation-generator)

- Single, standalone spec; only `@playwright/test` imported.
- Locator priority `data-testid` → role → label → CSS; never brittle CSS/`:nth-child`.
- Every assertion maps to a specific Expected Result and is web-first (auto-waiting); no hard waits.
- Never mock/bypass auth; no auth-note meta-commentary — keep comments to brief step annotations.
- Reference the Test Case ID in the `test()` title.
- Use the REAL, live-verified selectors and REAL created/known data — no invented selectors, routes,
  or placeholders.
