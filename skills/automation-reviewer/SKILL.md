---
name: automation-reviewer
description: Review generated Playwright + TypeScript automation for correctness, flakiness risk, locator quality, reuse of existing Page Objects/fixtures, and adherence to the Project Knowledge Base conventions, and produce a severity-rated review report with an Approve / Approve-with-changes / Reject verdict. Use AFTER automation-generator, when the user says "review the automation", "review the Playwright code", or "is this spec solid". Does NOT rewrite code unless asked.
version: 1.0.0
author: Andrew
---

# Automation Reviewer

## Purpose

Statically review the Playwright + TypeScript specs produced by `automation-generator` before they
run. The focus is correctness against the source test case, **flakiness prevention**, locator
quality, and **reuse discipline** (did it reuse existing assets or duplicate them). Output is a
**severity-rated review report** with a verdict — not a rewrite.

## Position in the QA Pipeline

```
... test-case-reviewer → automation-generator
        ↓ Playwright specs
[automation-reviewer]  ← you are here
        ↓ review report (verdict)
execution-analyzer → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- Playwright specs exist (from `automation-generator`) and need sign-off before execution.
- The user asks to review the automation / Playwright code.

## Inputs / Prerequisites

- The generated **spec files** (and any new/changed Page Objects, fixtures, helpers).
- **`knowledge.md` / `knowledge.json`** — the source of truth for locator strategy, existing
  assets, and coding conventions.
- The **source test cases** — to confirm the specs actually assert the intended expected results.

## Review Dimensions

1. **Correctness** — does the spec cover the test case's steps and assert its expected results?
2. **Flakiness risk** — hard-coded `waitForTimeout`/sleeps, race conditions, non-web-first
   assertions, order dependence, shared mutable state.
3. **Locator quality** — follows the KB priority (`data-testid` → `getByRole` → `getByLabel` →
   CSS → XPath)? No brittle CSS/XPath where a stable option exists.
4. **Reuse** — did it reuse existing Page Objects/fixtures/helpers, or duplicate them?
5. **Convention adherence** — naming, folder layout, async pattern, assertion style from the KB.
6. **Test isolation & idempotency** — each test independent and repeatable.
7. **Traceability** — each `test()` references its source Test Case ID / AC.
8. **Test data determinism** — no reliance on ambient/leftover data.

## Severity Levels

- **Critical** — spec doesn't test the intended behavior, or will fail/pass incorrectly.
- **Major** — real flakiness risk (hard waits, races), brittle locators, or duplicated assets that
  should have been reused.
- **Minor** — convention/style deviations that don't affect reliability.
- **Nit** — polish.

## Workflow

1. Load the specs, the source test cases, and the Knowledge Base.
2. Check each Review Dimension; cite **file:line** (or the selector) for every finding.
3. Where useful, give a concrete replacement snippet (e.g. the correct `getByTestId` call).
4. Rate each finding by severity; assess overall flakiness and reuse.
5. Decide the verdict and write the report using `templates/review-report.md`.

## Output

A review report following `templates/review-report.md`: verdict, findings table with file:line and
recommended fixes, a flakiness-risk callout, a reuse assessment, approved items, and the next step.

## Quality Rules

- Cite **file and line** (or the exact selector) for every finding.
- Give **concrete replacement code** where it helps.
- Verify claims against the actual spec — do not speculate about behavior you can't see.
- Do not rewrite code unless explicitly asked; recommend fixes instead.

## Handoff

Approved specs proceed to execution (then `execution-analyzer`). Rejected specs go back to
`automation-generator`. Findings also feed `report-generator`.
