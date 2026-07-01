---
name: execution-analyzer
description: Analyze Playwright execution results — JSON/HTML report, traces, screenshots, and failures — to classify each test as pass/fail/flaky, distinguish real product defects from test defects, flaky tests, and environment/data issues, and produce an execution summary. Use AFTER a test run, whenever the user says "analyze the test results", "review the report", "why did the run fail", "triage the failures", or hands over a `results.json` / HTML report.
version: 1.0.0
author: Andrew
---

# Execution Analyzer

## Purpose

Turn raw Playwright execution artifacts into an actionable, evidence-based summary. The goal is
not to restate pass/fail counts but to **classify every failure by root cause** so the team knows
what to fix: the product, the test, the environment, or nothing (flaky noise).

This skill separates *signal* (real product defects worth a ticket) from *noise* (flaky retries,
environment hiccups) using the evidence Playwright already captured — error messages, traces,
screenshots, and retry outcomes.

## Position in the QA Pipeline

```
project-bootstrap
        ↓ knowledge.md + knowledge.json
requirement-analyst → test-case-generator → test-case-reviewer
        → automation-generator → automation-reviewer → [execution-analyzer]  ← you are here
        → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- A Playwright run has finished and you have its report/artifacts.
- The user asks to triage failures, explain a red build, or summarize a run.
- Before filing defect tickets — this skill decides *which* failures deserve one.

Do **not** use this to write or fix specs (that is `automation-generator`); this skill is
read-only analysis of results.

## Inputs / Prerequisites

- Playwright results: `results.json` (JSON reporter) or the HTML report directory. JSON is preferred
  because it is machine-parseable and includes per-attempt status.
- Trace files (`trace.zip`), screenshots, and video artifacts referenced by failing tests.
- The test specs and `knowledge.md` for context (to map a failing test to its source Test Case ID
  and understand expected behavior / domain terms).

If no results file exists, ask the user to run the suite with the JSON reporter enabled
(`--reporter=json,html`) and provide the output path.

## Workflow

1. **Parse results** — load `results.json`; enumerate every test with its title, file, and all
   attempts (retries matter).
2. **Determine per-test status** — Passed, Failed (failed on all attempts), Flaky (failed then
   passed on retry), Skipped.
3. **For each failure, gather evidence** — the error type and message, the failing step, the
   trace, and the screenshot at point of failure.
4. **Classify the root cause** into exactly one category (see Failure Classification below).
5. **Link to the source Test Case** — resolve the spec back to its Test Case ID from
   `test-case-generator` output (via annotations/titles) so the failure is traceable.
6. **Recommend an action** per failure — file defect / fix test / stabilize selector / fix
   environment / no action.
7. **Emit the summary** using `templates/execution-summary.md`, plus a short list of suspected
   product defects ready to hand to `ticket-comment-generator`.

## Failure Classification

Assign each failure to one category, justified by evidence:

- **Product defect** — the app behaved incorrectly: assertion on a real business value failed, a
  page errored (500), or the UI contradicts the acceptance criteria. Evidence: assertion diff,
  console/network error, screenshot showing wrong state. → file a ticket.
- **Test defect** — the test is wrong: bad selector, stale expectation, wrong test data, logic
  error in the spec. Evidence: locator not found for an element that is clearly present, expected
  value hard-coded incorrectly. → fix the test.
- **Flaky** — passed on retry with no code change, or failed intermittently on timing. Evidence:
  attempt 1 failed, attempt 2 passed; timeout on a race, not a missing element. → stabilize
  (waits/locators), don't file a product defect.
- **Environment / data** — infra or data preconditions, not the product: service unavailable, DB
  seed missing, auth token expired, wrong base URL. Evidence: connection refused, 401 at login,
  empty seed data. → fix environment/data setup.
- **Timeout** — the action/assertion timed out. Sub-classify: genuine slowness/hang (may be a
  product perf defect) vs. an over-tight timeout or wrong locator (test defect). Never leave a
  timeout unclassified — inspect the trace to decide.

## Output

1. **Execution summary** — fill `templates/execution-summary.md` (result totals, per-failure
   analysis, suspected defects, flaky list, environment issues, recommendations).
2. **Suspected product defects** — a concise list of candidate ticket titles + one-line rationale,
   ready for `ticket-comment-generator`.

## Quality Rules

- Base every classification on concrete evidence (error message, trace step, screenshot). Quote it.
- Never label a test "flaky" without a reason — a first-run failure that never retried is **not**
  flaky; it is Failed until proven otherwise.
- Distinguish first-run vs. retry outcomes explicitly; a pass-on-retry is Flaky, not Passed.
- Do not invent defects. If evidence is inconclusive, mark the action as "needs investigation".
- Map failures to Test Case IDs where possible; note when a mapping can't be resolved.

## Handoff

- Suspected product defects → **ticket-comment-generator** (to draft the ADO/Jira comment).
- Failing screenshots worth annotating → **screenshot-annotator**.
- The overall run + trends → **report-generator** (for the stakeholder-facing report).
