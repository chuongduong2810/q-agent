# Example — execution-analyzer

## Input (excerpt of Playwright `results.json`)

```json
{
  "stats": { "expected": 1, "unexpected": 1, "flaky": 1, "skipped": 0, "duration": 48213 },
  "suites": [
    {
      "title": "invoice.spec.ts",
      "specs": [
        {
          "title": "TC-101 Agent pays an open invoice",
          "tests": [{ "results": [{ "status": "passed", "duration": 5120 }] }]
        },
        {
          "title": "TC-102 Invoice total reflects applied discount",
          "tests": [{ "results": [{
            "status": "failed",
            "error": { "message": "expect(received).toHaveText(expected)\nExpected: \"$90.00\"\nReceived: \"$100.00\"" },
            "attachments": [{ "name": "screenshot", "path": "test-results/tc-102/failed-1.png" },
                            { "name": "trace", "path": "test-results/tc-102/trace.zip" }]
          }]}]
        },
        {
          "title": "TC-103 Dashboard loads recent payments",
          "tests": [{ "results": [
            { "status": "failed", "error": { "message": "TimeoutError: locator.click: Timeout 5000ms exceeded waiting for getByTestId('refresh')" } },
            { "status": "passed", "duration": 4870 }
          ]}]
        }
      ]
    }
  ]
}
```

## Expected Output (`execution-summary.md`)

```md
# Execution Summary

- Run ID: portal-e2e-2026-07-02-14:05
- Environment: staging
- Base URL: https://staging.portal.example.com
- Date: 2026-07-02 14:05
- Playwright version: 1.44

## Result Summary
| Total | Passed | Failed | Flaky | Skipped | Pass rate | Duration |
|-------|--------|--------|-------|---------|-----------|----------|
| 3     | 1      | 1      | 1     | 0       | 33% (1/3 first-run) | 48.2s |

## Failure Analysis
| Test | Test Case ID | Status | Root-Cause Category | Evidence | Recommended Action |
|------|--------------|--------|---------------------|----------|--------------------|
| Invoice total reflects applied discount | TC-102 | Failed | Product defect | Assertion diff: expected $90.00, received $100.00 — 10% discount not applied; screenshot confirms wrong total | File defect ticket |
| Dashboard loads recent payments | TC-103 | Flaky | Flaky | Attempt 1 timed out on getByTestId('refresh'); attempt 2 passed with no change — timing race, not a missing element | Stabilize: await network idle before clicking refresh |

## Suspected Product Defects
1. **Discount not applied to invoice total (TC-102)** — total shows $100.00 instead of $90.00 with a 10% discount active. Evidence: assertion diff + screenshot `failed-1.png`.

## Flaky Tests
- TC-103 Dashboard loads recent payments — passed on retry; refresh button click raced page load.

## Environment / Data Issues
- None observed this run.

## Recommendations
- Immediate: file the discount-total defect (TC-102) — clear product bug.
- Test-suite: replace fixed click on 'refresh' in TC-103 with a wait for the payments request to settle.
- Follow-ups: none.
```

## Note
TC-102 is classified **Product defect** (business value wrong, backed by an assertion diff), while
TC-103 is **Flaky** (failed-then-passed on retry with no change) — only TC-102 becomes a ticket.
