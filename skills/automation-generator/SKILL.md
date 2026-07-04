---
name: automation-generator
description: Generate Playwright + TypeScript automation from approved manual test cases, reusing the project's existing Page Objects, fixtures, helpers, locator strategy, and auth strategy from the Project Knowledge Base. Use when the user says "automate these test cases", "generate Playwright specs", "write e2e tests for this ticket", or after test cases have been approved by test-case-reviewer.
version: 1.0.0
author: Andrew
---

# Automation Generator

## Purpose

Convert **approved** Azure DevOps-style manual test cases into runnable Playwright + TypeScript
specs that follow the target project's existing conventions.

This skill never writes automation from scratch or from a generic template mindset. It reads the
**Project Knowledge Base** and reuses what already exists — Page Objects, fixtures, helpers,
locator strategy, and authentication — so generated specs drop into the repo and run.

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

- Manual test cases exist and have been reviewed/approved by `test-case-reviewer`.
- The user asks to automate a ticket, a set of test cases, or a coverage area.
- A Project Knowledge Base (`knowledge.md` / `knowledge.json`) already exists.

Do **not** use this to design test scenarios — that is `test-case-generator`'s job. This skill
only implements already-approved cases.

## Inputs / Prerequisites

Required:

- **Approved ADO test cases** (from `test-case-generator`, reviewed by `test-case-reviewer`),
  each with a stable **Test Case ID**, steps, and expected results.
- **`knowledge.md` + `knowledge.json`** from `project-bootstrap`.

From the Knowledge Base you MUST reuse, not reinvent:

- Existing **Page Objects** and their public methods.
- Existing **fixtures** (`test.extend`, custom `test` object).
- Shared **helpers** (data builders, API setup, waits).
- The documented **locator strategy** (selector priority order).
- The **authentication strategy** (login flow, `storageState`, auth helpers).
- Coding standards: naming, folder layout, assertion style, async pattern.
- The application **base URL** and per-environment URLs (`environments`) — use them literally, don't guess a host.
- The real **application routes / URL patterns** discovered in the code (`routes`).
- The real **selectors / data-testids** discovered in the code (`selectors`: screen/element → selector).
- The **login URL and auth flow** (`auth.login_url`, `auth.login_flow`, `auth.storage_state`).
- The **test-account credentials supplied at generation time** (username + password from the injected project context) — reference them directly in the spec.

If any prerequisite is missing, stop and request that `project-bootstrap` (for the KB) or
`test-case-generator` / `test-case-reviewer` (for approved cases) be run first.

## Workflow

1. **Load context** — parse the approved test cases and the Knowledge Base.
2. **Plan reuse** — for each test case, identify which existing Page Object(s) and fixtures cover
   the involved screens/actions. List gaps (missing Page Object methods) explicitly.
3. **Map case → spec** — one `test()` per test case, tagged with its **Test Case ID** so results
   trace back through `execution-analyzer`.
4. **Extend, don't duplicate** — if an action isn't covered by an existing Page Object, add a
   method to that Page Object (following its style) rather than inlining selectors or creating a
   parallel object.
5. **Choose locators by KB priority** — use the project's documented order (typically
   `data-testid` → `getByRole` → `getByLabel` → CSS → XPath). Never hard-code brittle selectors
   when a higher-priority option exists.
6. **Handle auth via existing strategy** — reuse `storageState` / auth fixtures; do not re-script
   login inside every spec unless the KB shows that pattern.
7. **Bake in real project values** — use the REAL base URL, routes, selectors, login URL and
   test-account credentials from the injected project context DIRECTLY in the spec. Do not invent
   selectors or URLs, and do not emit placeholders, when the context provides them. Emit a
   clearly-marked `// TODO` placeholder only for a value that is genuinely absent from that context.
8. **Assert against expected results** — every "Expected Result" in the case becomes a web-first
   assertion (`await expect(...)`).
9. **Emit specs** — follow `templates/playwright-spec.ts`; place files per the KB folder convention.

## Output

- One or more Playwright spec files (`*.spec.ts`) following `templates/playwright-spec.ts`.
- A short **"New Page Object methods needed"** note listing any additions made to existing
  Page Objects (name, signature, purpose) so reviewers can verify reuse discipline.
- A **traceability list**: Test Case ID → `test()` title → file path.

## Quality Rules

- **Reuse before create (DRY).** Prefer extending an existing Page Object/fixture/helper over
  writing new code. Justify any new file.
- Follow the Knowledge Base's **coding standards and naming** exactly.
- Prefer **role / testid** locators per the KB priority; avoid raw CSS/XPath unless necessary.
- Each assertion must map to a specific **Expected Result** in the source case.
- **No hard-coded waits** (`page.waitForTimeout`). Use web-first assertions and auto-waiting.
- Specs must be **deterministic and independent** — no shared mutable state, no ordering
  dependencies between tests.
- Reference the source **Test Case ID** in each test so failures are traceable.
- **No unresolved placeholders** — bake in the real base URL, routes, selectors and credentials
  from the project context; a `// TODO` is allowed only for a value truly missing from the context,
  and each one must be called out in the handoff note.

## Handoff / Success Criteria

Generated specs run against the project without manual fixups beyond documented new Page Object
methods. They are consumed next by `automation-reviewer` (static quality/reuse review) and then by
`execution-analyzer` (runtime results). Success = every approved test case has a corresponding,
traceable, runnable `test()` that reuses existing assets.
