# Example — test-case-reviewer

## Input (excerpt of test cases under review)

> **TC-001** — Agent pays an open invoice (happy path). Linked AC1.
> **TC-002** — Payment rejected for amount 0. Linked AC2.
> _(No case exists for a negative amount, though the analysis lists BR1: amount must be > 0.)_
> TC-001 step 2 expected result reads only "payment works".

## Expected Output (excerpt of review-report.md)

**Verdict: Approve-with-changes**

### Summary
Core happy path and zero-amount validation are covered and traceable. One Major gap: the negative-amount
boundary from BR1/AC2 is untested. One Minor clarity issue on TC-001's expected result.

### Findings
| ID | Severity | Test Case | Dimension | Finding | Recommendation |
|----|----------|-----------|-----------|---------|----------------|
| F1 | Major | TC-002 | Coverage | AC2/BR1 only tests amount = 0; negative amount untested | Add TC for amount = -1 expecting the same inline error |
| F2 | Minor | TC-001 | Clarity | Step 2 expected result "payment works" is not measurable | Specify: success toast + status changes to "Paid" |

### Coverage Matrix
| Acceptance Criterion | Covered? | Test Cases | Gap |
|----------------------|----------|------------|-----|
| AC1 | Yes | TC-001 |  |
| AC2 | Partial | TC-002 | negative amount not covered |

### Overall Verdict & Next Step
- **Verdict:** Approve-with-changes
- **Next step:** Return F1/F2 to test-case-generator; once the negative-amount case is added, proceed to automation-generator.
