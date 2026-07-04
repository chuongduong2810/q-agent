---
name: screenshot-annotator
description: Turn a failure screenshot (and optional Playwright trace) from an execution run into an annotated description — what the UI shows, where it diverged from the expected result, and ticket-ready callouts. Use when the user says "annotate this screenshot", "explain the failure screenshot", or right after execution-analyzer flags a failing test that needs visual evidence.
version: 1.0.0
author: Andrew
---

# Screenshot Annotator

## Purpose

Take failure screenshots (and Playwright traces) from an execution run and produce a clear,
annotated description: what the screenshot actually shows, where the UI diverged from the
expected result of the associated Test Case, and specific callouts that can be attached to a
defect ticket.

This turns raw visual evidence into structured, reviewable notes that downstream skills can
paste directly into a bug ticket or QA report.

## Position in the QA Pipeline

```
project-bootstrap
        ↓ knowledge.md + knowledge.json
requirement-analyst → test-case-generator → test-case-reviewer
        → automation-generator → automation-reviewer → execution-analyzer
                                                             ↓ flagged failure + screenshot/trace
                                                    [screenshot-annotator]  ← you are here
                                                             ↓ annotation notes
                                        ticket-comment-generator / report-generator
```

## When to Use

- `execution-analyzer` flagged a failing test and there is a screenshot or trace to interpret.
- The user asks to "annotate this screenshot", "explain the failure screenshot", or describe
  what went wrong visually before filing a defect.

## Inputs

- Path to the failure screenshot and/or Playwright trace (`trace.zip`).
- The failing **Test Case's expected result** (from `test-case-generator` output) and its Test Case ID.
- `knowledge.md` — for UI terminology, routes, and component names so callouts use project language.

## Workflow

1. **Describe the actual UI state** — read the screenshot (and trace frames) and state plainly
   what is on screen: page/route, key components, values, error banners, empty states.
2. **Recall the expected result** — restate what the Test Case expected at this step.
3. **Compare** — identify each discrepancy between actual and expected.
4. **Mark regions** — for each discrepancy, name the UI region/component (using KB terminology)
   and the observation; assign a severity.
5. **Produce a caption and callout list** — a short caption plus the callouts table, ready to
   attach to a ticket.

## Output

Annotation notes in Markdown, following `templates/annotation-notes.md`. The notes must be
self-contained and pasteable into a defect ticket or QA report, and must reference the Test Case ID.

## Automatic Annotation Mode (visual, per test case)

Evidence is collected and annotated **per individual test case** (not per ticket). When a case
fails, this skill also runs automatically to draw the problem directly on the failure screenshot:
the app sends the screenshot + Playwright error and expects **compact JSON only** (the caller pins
the shape; do not emit prose in this mode):

```json
{"diagnosis":"<=200 char plain-language likely root cause",
 "shapes":[
   {"tool":"rectangle","x":10,"y":20,"w":40,"h":12,"color":"#f43f5e"},
   {"tool":"arrow","x":50,"y":60,"x2":40,"y2":28,"color":"#f43f5e"},
   {"tool":"text","x":10,"y":6,"text":"short label","color":"#f43f5e"}
 ]}
```

- All coordinates are **percent** of image width/height (0–100). `tool` ∈ rectangle / arrow /
  highlight / circle / text. Keep to at most 4 shapes.
- Draw a box around the element that is wrong / missing / unexpected; optionally an arrow to it and
  a short label. If you cannot localise it, return `"shapes":[]` but still give a `diagnosis`.
- The shapes are burned onto a copy of the screenshot (Pillow) and stored as the annotated
  evidence for that test case; `diagnosis` is shown in the Evidence view and folded into the
  consolidated ticket comment. Describe only what is visible (same quality rules as above).

## Quality Rules

- Describe **only what is visible** in the screenshot/trace. Do not infer hidden state,
  backend behavior, or off-screen content.
- Always reference the Test Case ID and the specific expected result being compared against.
- Use project terminology from `knowledge.md` for regions and components.
- Distinguish observation (what is shown) from interpretation (what it likely means), and label
  interpretations as such.
- Assign severity conservatively and consistently.

## Handoff

Annotation notes feed `ticket-comment-generator` (to draft the bug ticket/comment) and
`report-generator` (as defect evidence in the QA report).
