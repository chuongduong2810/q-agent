# Example — test-case-generator

## Input (excerpt of requirement-analysis.md)

> **AC1** — A signed-in Agent can pay an open invoice; on success the invoice status becomes "Paid".
> **AC2** — Payment is rejected if the amount is 0 or negative; an inline error is shown.
> **AC3** — A Viewer role cannot see the "Pay now" button.
>
> Business rules: BR1 (validation) amount must be > 0; BR3 (permission) only Agent/Admin may pay.

## Expected Output (excerpt)

### Requirement Coverage Matrix
| Acceptance Criterion | Covered? | Test Case IDs | Gap / Note |
|----------------------|----------|---------------|------------|
| AC1 | Yes | TC-001 |  |
| AC2 | Yes | TC-002 |  |
| AC3 | Yes | TC-003 |  |

### TC-001 — Agent pays an open invoice successfully (happy path)
- **Objective:** Verify an Agent can pay an open invoice and status updates to "Paid".
- **Priority:** High · **Test Type:** Functional · **Automation Candidate:** Yes · **Linked AC:** AC1
- **Preconditions:** Signed in as Agent; an invoice INV-100 exists with status "Open".
- **Test Data:** amount = 150.00
- **Steps:**
  | # | Action | Expected Result |
  |---|--------|-----------------|
  | 1 | Open invoice INV-100 | Invoice detail shows status "Open" and a "Pay now" button |
  | 2 | Click "Pay now", enter 150.00, confirm | Success toast appears; status changes to "Paid" |

### TC-002 — Payment rejected for non-positive amount (validation / negative)
- **Objective:** Verify amount ≤ 0 is rejected with an inline error (BR1).
- **Priority:** High · **Test Type:** Validation · **Automation Candidate:** Yes · **Linked AC:** AC2
- **Preconditions:** Signed in as Agent; invoice INV-100 is "Open".
- **Steps:**
  | # | Action | Expected Result |
  |---|--------|-----------------|
  | 1 | Open INV-100, click "Pay now", enter 0 | Inline error "Amount must be greater than 0"; status stays "Open" |

### TC-003 — Viewer cannot pay (permission)
- **Objective:** Verify a Viewer does not see "Pay now" (BR3).
- **Priority:** Medium · **Test Type:** Permission · **Automation Candidate:** Yes · **Linked AC:** AC3
- **Preconditions:** Signed in as Viewer; invoice INV-100 is "Open".
- **Steps:**
  | # | Action | Expected Result |
  |---|--------|-----------------|
  | 1 | Open INV-100 | Invoice detail renders; no "Pay now" button is present |

## Note
Terminology ("Agent", "Viewer", "invoice", status "Paid"/"Open") is taken from the Knowledge Base,
not invented. AC2's boundary (negative amount) is derived from BR1 in the analysis.
