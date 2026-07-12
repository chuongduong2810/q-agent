---
name: test-case-reviewer
description: Review generated manual test cases for coverage, correctness, clarity, and traceability against the requirement analysis and Project Knowledge Base, and produce a severity-rated review report with an Approve / Approve-with-changes / Reject verdict. Use AFTER test-case-generator, when the user says "review the test cases", "check test coverage", or "are these test cases good". Does NOT rewrite the test cases unless asked.
version: 1.0.0
author: Andrew
---

# Test Case Reviewer

## Purpose

Independently review the manual test cases produced by `test-case-generator` and decide whether
they are complete, correct, and traceable enough to proceed to automation. The output is a
**severity-rated review report** with a clear verdict — not a rewrite of the cases.

## Position in the QA Pipeline

```
project-bootstrap → requirement-analyst → test-case-generator
        ↓ ADO test cases + coverage matrix
[test-case-reviewer]  ← you are here
        ↓ review report (verdict)
automation-generator → automation-reviewer → execution-analyzer
        → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- Test cases exist (from `test-case-generator`) and need sign-off before automation.
- The user asks to review test cases or check coverage.

## Inputs / Prerequisites

- The generated **test cases** and their **Requirement Coverage Matrix**.
- **`requirement-analysis.md`** — the ground truth for coverage and expected behavior.
- **`knowledge.md`** — for terminology, roles, and format expectations.

## Review Dimensions

Evaluate every test case (and the set as a whole) against:

1. **Coverage** — is every Acceptance Criterion and business rule from the analysis covered?
2. **Correctness** — do expected results match the requirement analysis (not assumptions)?
3. **Clarity / reproducibility** — can another engineer execute the steps without guessing?
4. **Test data adequacy** — is data specified, valid, and sufficient for each case?
5. **Duplication / overlap** — are there redundant or overlapping cases?
6. **Traceability** — does each case link to an AC, and each AC to ≥1 case?
7. **ADO format compliance** — are all required fields present and well-formed?
8. **Automation-candidate correctness** — are the right cases flagged (stable, deterministic)?

## Severity Levels

- **Critical** — a required AC/business rule is completely untested, or an expected result is wrong.
- **Major** — meaningful coverage gap, incorrect data, or a case that cannot be executed as written.
- **Minor** — clarity, wording, or minor format issues that don't block execution.
- **Nit** — style/consistency polish.

## Workflow

1. Load the test cases, coverage matrix, `requirement-analysis.md`, and `knowledge.md`.
2. Check each Review Dimension; for each issue, cite the **Test Case ID** and the **AC** involved.
3. Build a coverage gap list from the analysis (every AC and business rule).
4. Rate each finding by severity and give a concrete, actionable recommendation.
5. Decide the verdict and write the report using `templates/review-report.md`.

## Output

A review report following `templates/review-report.md`: verdict (Approve / Approve-with-changes /
Reject), findings table, coverage matrix with gaps, missing-scenario list, approved items, and the
next step.

> **Q-Agent pipeline mode.** In the automated Q-Agent pipeline the generator emits only the
> happy-path set on purpose, so here you are explicitly asked to ALSO produce the deferred
> coverage: after listing the gaps, generate the additional negative, invalid-input, boundary,
> permission, empty-state and error-handling test cases that fill them (without duplicating the
> happy-path cases). The calling prompt pins the exact JSON shape to return.

## Quality Rules

- Cite the specific **Test Case ID** and **Acceptance Criterion** for every finding.
- Verify against the **requirement analysis**, not against assumptions.
- Findings must be **specific and actionable** — no vague "improve coverage" notes.
- Do not rewrite the test cases unless explicitly asked; recommend changes instead.

## Handoff

Approved cases proceed to `automation-generator`. Rejected or changed cases go back to
`test-case-generator` for revision. The verdict and gaps also feed `report-generator`.
