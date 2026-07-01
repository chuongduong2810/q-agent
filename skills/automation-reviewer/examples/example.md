# Example — automation-reviewer

## Input (excerpt of a generated spec)

```ts
test('pay invoice', async ({ page }) => {           // TC-001 / AC1
  await page.goto('/invoices/INV-100');
  await page.waitForTimeout(3000);                  // wait for load
  await page.locator('//div[3]/button').click();    // "Pay now"
  await page.fill('#amt', '150');
  await page.click('text=Confirm');
  // no assertion on the resulting status
});
```

Knowledge Base says: locator priority is `data-testid` first; an `InvoiceListPage`/`InvoicePage`
Page Object exists with `pay(amount)`; web-first assertions required; no hard waits.

## Expected Output (excerpt of review-report.md)

**Verdict: Approve-with-changes**

### Findings
| ID | Severity | File:Line | Dimension | Finding | Recommended Fix |
|----|----------|-----------|-----------|---------|-----------------|
| F1 | Major | spec:3 | Flakiness | `waitForTimeout(3000)` hard wait | Remove; rely on web-first `await expect(...)` auto-waiting |
| F2 | Major | spec:4 | Locator | Brittle absolute XPath `//div[3]/button` | `await invoicePage.payButton` / `page.getByTestId('pay-now')` per KB |
| F3 | Critical | spec:1-7 | Correctness | No assertion on expected result (status → "Paid") | Add `await expect(invoicePage.status).toHaveText('Paid')` |
| F4 | Major | spec:1-7 | Reuse | Inlines selectors instead of using existing `InvoicePage.pay()` | Reuse `InvoicePage.pay(150)` |

### Flakiness Risk
High until F1 is fixed — the hard wait both slows the suite and hides real races.

### Reuse Assessment
`InvoicePage` Page Object already exposes `pay(amount)` and typed locators; the spec should reuse it
instead of raw selectors.

### Overall Verdict & Next Step
- **Verdict:** Approve-with-changes
- **Next step:** Return to automation-generator to apply F1–F4; re-review before execution.
