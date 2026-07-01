---
name: report-generator
description: Aggregate the whole QA pipeline's artifacts — requirement analysis, test cases + coverage, review verdicts, execution summary, and defects — into a single stakeholder-facing QA report with a clear go / no-go recommendation. Use at the end of a QA cycle, or when the user says "generate the QA report", "summarize the QA cycle", or "produce the test summary report".
version: 1.0.0
author: Andrew
---

# Report Generator

## Purpose

Aggregate every artifact produced across the QA pipeline into a single, stakeholder-facing QA
report: requirement analysis, generated test cases and their coverage, review verdicts,
execution results, and defects found — ending in a clear quality verdict and go / no-go
recommendation.

## Position in the QA Pipeline

```
project-bootstrap → requirement-analyst → test-case-generator → test-case-reviewer
        → automation-generator → automation-reviewer → execution-analyzer
                → screenshot-annotator → ticket-comment-generator
                                                             ↓ all artifacts
                                                    [report-generator]  ← you are here
                                                             ↓ QA report (stakeholder-facing)
```

## When to Use

- A QA cycle is complete (or at a milestone) and stakeholders need a consolidated summary.
- The user asks to "generate the QA report", "summarize the QA cycle", or "produce the test summary".

## Inputs

- Requirement analysis (from `requirement-analyst`).
- Test cases + requirement coverage matrix (from `test-case-generator`).
- Review verdicts (from `test-case-reviewer` and `automation-reviewer`).
- Execution summary (from `execution-analyzer`) and any defects (from `ticket-comment-generator`).
- `knowledge.md` — for project name, environment, and terminology.

## Workflow

1. **Collect** all upstream artifacts and confirm which are present; note any that are missing.
2. **Summarize coverage** — Acceptance Criteria covered vs uncovered, from the coverage matrix.
3. **Summarize execution results** — totals, pass rate, flaky/blocked counts, from the execution summary.
4. **Highlight defects and risks** — list defects with severity/status; surface residual risks and assumptions.
5. **Recommend** — a clear quality verdict and go / no-go recommendation grounded in the data above.

## Output

A consolidated QA report in Markdown following `templates/qa-report.md`.

## Quality Rules

- Every number and claim must be **traceable to a source artifact** — do not invent metrics.
- If an input artifact is missing, state that explicitly rather than estimating.
- Executive-readable: lead with the summary and verdict; keep detail in later sections/appendix.
- Give a **clear go / no-go recommendation**, with the reasons that drove it.

## Handoff

The QA report is the final deliverable of the pipeline — shared with stakeholders and linked
back to the originating ticket.
