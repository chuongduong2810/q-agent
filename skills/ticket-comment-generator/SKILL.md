---
name: ticket-comment-generator
description: Draft a clear, polite Azure DevOps / Jira comment or bug-ticket body from an analyzed failure or QA finding — with reproduction steps, expected vs actual, environment, and evidence links. Use when the user says "write a bug comment/ticket", "post a QA update", "draft an ADO/Jira comment", or after execution-analyzer / screenshot-annotator surface a suspected defect.
version: 1.0.0
author: Andrew
---

# Ticket Comment Generator

## Purpose

Draft a clear, polite Azure DevOps / Jira comment or bug-ticket body from an analyzed failure
or QA finding. Produce either a **new bug ticket** (full reproduction detail) or a **progress /
update comment** (spoken-style status), using the evidence already gathered by upstream skills.

## Position in the QA Pipeline

```
project-bootstrap
        ↓ knowledge.md + knowledge.json
requirement-analyst → test-case-generator → test-case-reviewer
        → automation-generator → automation-reviewer → execution-analyzer
                                                             ↓ failure analysis
                                                    screenshot-annotator
                                                             ↓ annotation notes
                                            [ticket-comment-generator]  ← you are here
                                                             ↓ bug ticket / comment
                                                    report-generator
```

## When to Use

- `execution-analyzer` and/or `screenshot-annotator` produced a suspected defect that needs filing.
- The user asks to "write a bug ticket/comment", "post a QA update", or "draft an ADO/Jira comment".

## Inputs

- The **failure analysis** (from `execution-analyzer`) and/or **screenshot annotation notes**
  (from `screenshot-annotator`).
- The related **Test Case ID** and its expected result; linked Acceptance Criteria if known.
- `knowledge.md` — for environment details, URLs, and correct domain/UI terminology.

## Consolidation Rule (one comment per ticket)

A run executes **many test cases per ticket**. Post exactly **one consolidated comment per
ticket** that aggregates the findings of **all** of that ticket's executed test cases — never a
comment about a single case. The ticket's overall status is the **summary of every case**: it is
"Passed" only when **all** cases pass; **any** failing case means the ticket failed. Structure the
consolidated comment as:

1. **Overall verdict** — one line: `N/total cases passed` and the resulting ticket status.
2. **Per-case breakdown** — a short bullet per test case (id + PASS/FAIL + one-line note).
3. **Consolidated key findings** — for the failures only, the combined root-cause findings, folding
   in each failing case's screenshot **diagnosis** and evidence link.

## Workflow

1. **Choose the mode** — new **Bug Ticket** (defect found) or **Progress/Update Comment** (status/clarification).
2. **Aggregate the ticket's cases** — collect every executed test case for the ticket with its
   pass/fail status, error, and annotation diagnosis; compute the overall (all-pass vs any-fail) status.
3. **Gather facts** — repro steps, expected vs actual, environment, evidence links, from the inputs.
4. **Write in project language** — reuse terminology and environment names from `knowledge.md`.
5. **Draft** using `templates/ticket-comment.md` for the chosen mode.
6. **Attach evidence** — link the annotated screenshots, trace files, and annotation notes per case.

## Output

A ready-to-post Markdown comment or bug-ticket body following `templates/ticket-comment.md`.

## Quality Rules

- **Factual and reproducible** — every step must be something a reader can follow to reproduce.
- Professional, polite, spoken-style tone. **No blame**, no speculation stated as fact.
- Reuse terminology and environment names from `knowledge.md`.
- Always include evidence links and the linked Test Case ID / Acceptance Criteria.
- Keep expected vs actual explicit and separate.

## Handoff

The bug ticket/comment is filed in Azure DevOps / Jira and referenced by `report-generator`
in the final QA report's defect table.
