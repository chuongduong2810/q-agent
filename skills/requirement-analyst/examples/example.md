# Example — requirement-analyst

## Input (Azure DevOps ticket)

> **#4821 — Allow agents to apply a partial refund to a paid invoice**
>
> **Description:** Support agents need to refund part of an invoice without cancelling it.
> Refunds must not exceed the amount already paid.
>
> **Acceptance Criteria:**
> - AC-1: An agent can enter a refund amount on a paid invoice.
> - AC-2: The refund amount cannot exceed the paid amount.
> - AC-3: A refund is recorded in the invoice history with the agent's name and timestamp.
> - AC-4: Viewers cannot issue refunds.

*(Project Knowledge Base defines entities Customer, Invoice, Payment and roles Admin, Agent, Viewer.)*

## Expected Output (excerpt of `requirement-analysis.md`)

```md
## Business Objective
- Business goal: Reduce full cancellations by supporting partial refunds.
- User goal: An Agent refunds part of a paid invoice in one action.

## Business Rules
| Rule ID | Category    | Rule                                              | Source |
|---------|-------------|---------------------------------------------------|--------|
| BR-1    | Validation  | Refund amount ≤ amount paid on the invoice        | AC-2   |
| BR-2    | Permission  | Only Admin/Agent may refund; Viewer may not       | AC-4   |
| BR-3    | Data        | Refund logs agent name + timestamp in history     | AC-3   |

## Acceptance Criteria Breakdown
| AC ID | Meaning                       | Dependencies | Ambiguities / Missing Info                 | Expected Behavior |
|-------|-------------------------------|--------------|--------------------------------------------|-------------------|
| AC-2  | Cap refund at paid amount     | AC-1         | Are multiple partial refunds cumulative?   | Reject > paid; error shown |
| AC-4  | Viewers blocked from refunds  | roles in KB  | Should the control be hidden or disabled?  | No refund action for Viewer |

## Missing Information
- Q-1: Can an invoice receive multiple partial refunds, and is the cap against remaining balance or original paid amount?
- Q-2: Currency/rounding rules for partial amounts?

## Requirement Coverage Plan
| AC ID | Proposed Test Areas / Scenarios                          | Covered? | Notes |
|-------|----------------------------------------------------------|----------|-------|
| AC-2  | Boundary (=paid), Negative (>paid), Validation error msg | Yes      |       |
| AC-4  | Permission test as Viewer vs Agent                       | Yes      |       |
```

## Note
The analyst flagged the cumulative-refund ambiguity (Q-1) instead of assuming behavior — this is a
Missing Information item, not a test case.
