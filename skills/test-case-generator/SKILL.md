---
name: test-case-generator
description: Generate Azure DevOps-style manual test cases from a requirement analysis, plus a requirement coverage matrix and automation-candidate list. Use AFTER requirement-analyst, when the user says "generate test cases", "write test cases for NNN", or "turn this analysis into test cases". Consumes requirement-analysis.md + the Project Knowledge Base. Does NOT write automation code.
version: 1.0.0
author: Andrew
---

# Test Case Generator

## Purpose

Generate complete, review-ready **manual test cases** in Azure DevOps format from a
Requirement Analysis. This skill never works from a ticket alone — it combines the requirement
analysis, the Project Knowledge Base (domain terms, workflows, existing automation patterns) to
produce comprehensive cases a QA engineer can approve with minimal edits.

## Position in the QA Pipeline

```
project-bootstrap
        ↓ knowledge.md + knowledge.json
requirement-analyst
        ↓ requirement-analysis.md
[test-case-generator]  ← you are here
        ↓ ADO test cases + coverage matrix
test-case-reviewer → automation-generator → automation-reviewer → execution-analyzer
        → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- A `requirement-analysis.md` exists (from `requirement-analyst`) and needs to become test cases.
- The user asks to generate/write test cases for a ticket or feature.

Do **not** design requirements here (that is `requirement-analyst`) or write automation
(that is `automation-generator`).

## Inputs / Prerequisites

- **`requirement-analysis.md`** from `requirement-analyst` (the primary source).
- **`knowledge.md` / `knowledge.json`** from `project-bootstrap` for terminology, roles, workflows,
  and existing automation patterns.

If either is missing, run `requirement-analyst` and/or `project-bootstrap` first.

## Workflow

1. **Absorb the analysis** — business objective, functional requirements, business rules, edge
   cases, risks, and the per-AC breakdown.
2. **Plan coverage** — map every Acceptance Criterion to the scenarios needed to prove it, using
   the Coverage Rules below. Track which AC each planned case satisfies.
3. **Generate cases** — write each test case using `templates/ado-testcase.md`, reusing project
   terminology from the Knowledge Base.
4. **Build the coverage matrix** — map each AC → the Test Case IDs that cover it; flag any AC with
   no coverage.
5. **Mark automation candidates** — flag stable, high-value, deterministic cases as automation
   candidates for `automation-generator`.

## Coverage Rules

Generate cases across these dimensions (no duplicates, no overlapping scenarios):

- Happy paths
- Negative paths / invalid inputs
- Boundary values
- Required and optional field validation
- Permission / role-based access
- Error handling
- Empty states
- Duplicate data
- Business-rule validation (from the analysis)
- Regression risks

## Output

1. **Azure DevOps test cases** — following `templates/ado-testcase.md` (ID, Title, Objective,
   Preconditions, Test Data, numbered Steps with Action/Expected Result, Priority, Test Type,
   Automation Candidate, Linked AC, Notes).
2. **Requirement Coverage Matrix** — AC → Test Case IDs, with gaps flagged.
3. **Automation Candidates** — the subset recommended for Playwright automation.

## Quality Rules

- Prefer **completeness over quantity**; every AC must be covered or its gap reported.
- Every step's **Expected Result must be measurable** and objectively verifiable.
- Reuse business terminology from the Knowledge Base; **never invent undocumented functionality**.
- Clearly mark assumptions; do not silently fill gaps left by the analysis.
- No duplicate or overlapping test cases.

## Handoff / Success Criteria

Output is directly importable into Azure DevOps and serves as the source for `test-case-reviewer`
and later `automation-generator`. Success = a QA engineer approves the set with minimal edits and
every Acceptance Criterion is traceable to at least one test case.
