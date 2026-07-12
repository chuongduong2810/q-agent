---
name: automation-generator
description: Generate a runnable, standalone Playwright + TypeScript spec from an approved manual test case, baking in the real base URL, credentials, routes and selectors discovered in the Project Knowledge Base. Use when the user says "automate these test cases", "generate Playwright specs", "write e2e tests for this ticket", or after test cases have been approved by test-case-reviewer.
version: 1.1.0
author: Andrew
---

# Automation Generator

## Purpose

Convert **one approved** Azure DevOps-style manual test case into a single, runnable, self-contained
Playwright + TypeScript spec file.

This skill never invents application structure. It reads the **Project Knowledge Base**
(`knowledge.md` / `knowledge.json`) and bakes the real base URL, real test-account credentials, real
routes, and real selectors directly into the generated spec so it runs with no manual fixups.

## The Standalone-Spec Architecture (read this before generating)

Each case is generated **independently**, one Claude call at a time, with no access to the rest of a
project's codebase (no page objects, no fixtures, no helper files to import — they usually don't
exist as importable modules the generated spec can reach). The **only** inputs are:

- the test case (title, precondition, steps, expected results), and
- the Project Knowledge Base's discovered facts — base URL, routes, selectors, auth flow, and the
  **names** of any existing Page Objects / fixtures / utilities (informational only; there is no file
  path to import them from).

Because of this, every generated spec MUST be a **single, self-contained file**:

- `import { test, expect } from '@playwright/test';` — **no other imports**. Do not invent
  `import { LoginPage } from '../pages/LoginPage'` or similar; that module does not exist in the
  generated spec's directory and the file will fail to compile.
- **One `test()` block per case**, inlining login, navigation, actions and assertions directly against
  `page`. If the KB documents a `storageState`/auth flow, describe the login inline using the real
  login URL and real test-account credentials — do not assume a reusable auth fixture is importable.
- If the KB names existing Page Objects/fixtures/utilities that already wrap a screen, you may mention
  them in a short comment (so a human can later wire the file into that structure) — but the spec
  itself must still work standalone with only `@playwright/test`.

## Position in the QA Pipeline

```
project-bootstrap
        ↓ knowledge.md + knowledge.json
requirement-analyst → test-case-generator → test-case-reviewer
        ↓ approved test cases
[automation-generator]  ← you are here
        ↓ Playwright specs
automation-reviewer → execution-analyzer
        → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- A manual test case exists and has been reviewed/approved by `test-case-reviewer`.
- The user asks to automate a ticket, a test case, or a coverage area.
- A Project Knowledge Base (`knowledge.md` / `knowledge.json`) already exists.

Do **not** use this to design test scenarios — that is `test-case-generator`'s job. This skill
only implements an already-approved case.

## Inputs / Prerequisites

Required:

- **One approved ADO test case** (from `test-case-generator`, reviewed by `test-case-reviewer`), with
  a stable **Test Case ID**, steps, and expected results.
- **`knowledge.md` + `knowledge.json`** from `project-bootstrap`.

From the Knowledge Base, use directly (do not invent):

- The application **base URL** and per-environment URLs (`environments`).
- The real **application routes / URL patterns** discovered in the code (`routes`).
- The real **selectors / data-testids** discovered in the code (`selectors`: screen/element → selector).
- The **login URL and auth flow** (`auth.login_url`, `auth.login_flow`, `auth.storage_state`).
- The **test-account credentials supplied at generation time** (username + password from the injected
  project context) — reference them directly in the spec.
- The documented **locator strategy** (selector priority order).
- The names of existing **Page Objects / fixtures / utilities** — informational context only (see
  above); never import them.

If any prerequisite is missing, stop and request that `project-bootstrap` (for the KB) or
`test-case-generator` / `test-case-reviewer` (for the approved case) be run first.

## Workflow

1. **Load context** — parse the approved test case and the Knowledge Base.
2. **Map case → spec** — one `test()` for the case, its title prefixed with the case's **Test Case
   ID** (e.g. `test('TC-01 — Login with valid credentials', async ({ page }) => { ... })`) so results
   trace back through `execution-analyzer`.
3. **Choose locators by KB priority** — use the project's documented order (typically
   `data-testid` → `getByRole` → `getByLabel` → CSS → XPath). Never hard-code brittle selectors
   (raw CSS classes, DOM-structure-dependent combinators, `:nth-child`) when a higher-priority,
   KB-known option exists.
4. **Inline auth** — log in using the real login URL/flow and the real test-account credentials from
   the injected project context. Do not import a fixture module that doesn't exist in the spec file.
5. **Bake in real project values** — use the REAL base URL, routes, selectors, login URL and
   test-account credentials from the injected project context DIRECTLY in the spec. Do not invent
   selectors or URLs, and do not emit placeholders, when the context provides them. Emit a
   clearly-marked `// TODO` placeholder only for a value that is genuinely absent from that context.
6. **Assert against expected results** — every "Expected Result" in the case becomes a **web-first
   assertion** (`await expect(locator).toBeVisible()`, `.toHaveText(...)`, etc.), relying on
   Playwright's built-in auto-waiting.
7. **No hard waits** — never use `page.waitForTimeout(...)` or other arbitrary sleeps. Web-first
   assertions and auto-waiting locators are the only waiting mechanism.
8. **Emit the spec** — one self-contained `*.spec.ts` file following `templates/playwright-spec.ts`.

## Output

- One Playwright spec file (`*.spec.ts`) following `templates/playwright-spec.ts`: a single
  self-contained `test()`, importing only `@playwright/test`, tagged with its source Test Case ID.

## Quality Rules

- **Single, standalone spec.** Only `import { test, expect } from '@playwright/test';`. Never invent
  imports of Page Objects, fixtures, or helper modules that don't exist in the generated file's
  directory.
- Follow the Knowledge Base's **locator priority** — prefer `data-testid`/role/label; avoid raw
  CSS/XPath, bare class selectors, and `:nth-child`/`:nth-of-type` combinators.
- Each assertion must map to a specific **Expected Result** in the source case, and must be a
  **web-first assertion** (auto-waiting) — never a manual `waitForTimeout`.
- **No hard-coded waits** (`page.waitForTimeout`).
- The spec must be **deterministic and independent** — no shared mutable state, no ordering
  dependencies with other specs.
- Reference the source **Test Case ID** in the `test()` title so failures are traceable.
- **No unresolved placeholders** — bake in the real base URL, routes, selectors and credentials
  from the project context; a `// TODO` is allowed only for a value truly missing from the context.

## Handoff / Success Criteria

The generated spec runs against the project standalone, with no manual fixups. It is consumed next by
`automation-reviewer` (static quality review) and then by `execution-analyzer` (runtime results).
Success = the approved test case has a corresponding, traceable, runnable `test()` with web-first
assertions and no hard waits.
