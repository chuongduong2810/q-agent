# Example — automation-generator

## Input (approved manual test cases + Project Knowledge Base)

Knowledge Base (excerpt) says: Playwright 1.44 / TypeScript; locator priority `data-testid` →
`getByRole`; existing Page Objects `LoginPage`, `InvoiceListPage`; auth via `storageState` fixture
`test` exported from `e2e/fixtures.ts`.

**TC-2481-001 — Pay an open invoice (happy path)**
- Preconditions: Logged in as Agent; invoice `INV-1001` is in status *Open*.
- Steps:
  1. Open invoice `INV-1001`.
  2. Click **Pay now**.
  3. Confirm payment.
- Expected Results:
  - Confirmation banner is shown.
  - Invoice status becomes *Paid*.

**TC-2481-002 — Pay now blocked for Viewer role (permission)**
- Preconditions: Logged in as Viewer; invoice `INV-1001` is *Open*.
- Steps:
  1. Open invoice `INV-1001`.
- Expected Results:
  - **Pay now** action is not available.

## Expected Output — `e2e/tests/invoice-payment.spec.ts`

```ts
/**
 * Source ticket : ADO-2481
 * Traceability  : TC-2481-001 → "pay an open invoice",
 *                 TC-2481-002 → "viewer cannot pay"
 * Reused assets : LoginPage, InvoiceListPage; `test` fixture (storageState)
 * New PO methods: InvoiceListPage.pay(id)  // added — payment flow not previously covered
 */
import { test, expect } from '../fixtures';        // reused auth fixture (storageState)
import { InvoiceListPage } from '../pages/InvoiceListPage';

test.describe('Invoice payment — ADO-2481', () => {
  test('TC-2481-001 pay an open invoice', async ({ agentPage }) => {
    const invoices = new InvoiceListPage(agentPage);
    await invoices.goto();

    // Act — reuse/extend Page Object rather than inlining selectors
    await invoices.pay('INV-1001');

    // Assert — one assertion per Expected Result
    await expect(invoices.confirmationBanner).toBeVisible();
    await expect(invoices.statusBadge('INV-1001')).toHaveText('Paid');
  });

  test('TC-2481-002 viewer cannot pay', async ({ viewerPage }) => {
    const invoices = new InvoiceListPage(viewerPage);
    await invoices.goto();
    await invoices.open('INV-1001');

    // Permission expected result — action absent
    await expect(invoices.payButton).toBeHidden();
  });
});
```

## Notes on reuse discipline
- `data-testid`-based locators live inside `InvoiceListPage`, not the spec (KB locator priority).
- Auth uses the existing `agentPage` / `viewerPage` fixtures — no login re-scripted per test.
- Only one new Page Object method (`pay(id)`) was introduced, and it is flagged in the header for
  the reviewer.
