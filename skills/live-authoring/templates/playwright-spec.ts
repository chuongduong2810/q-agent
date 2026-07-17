/**
 * E2E spec — authored live by live-authoring (driven against the real app)
 * ---------------------------------------------------------------------------
 * Source ticket : <ADO/Jira ID>
 * Test Case ID  : <TC-NN>
 *
 * Standalone spec: this file is self-contained. The base URL, credentials,
 * routes and selectors below were VERIFIED LIVE against the running app while
 * authoring — they are real, not inferred. The ONLY import is '@playwright/test'.
 * Do not import a Page Object, fixture, or helper module; it does not exist in
 * this file's directory and the spec must compile and run on its own.
 * ---------------------------------------------------------------------------
 */
import { test, expect } from '@playwright/test';

test('<TC-NN> — <test case title>', async ({ page }) => {
  // --- Arrange / login ---
  // Real login URL + real test-account credentials from the project context,
  // inlined here. Never mock or bypass auth.
  await page.goto('<real base URL / login route>');
  await page.getByLabel('Username').fill('<real test-account username>');
  await page.getByLabel('Password').fill('<real test-account password>');
  await page.getByRole('button', { name: 'Log in' }).click();

  // --- Setup / test data (only if the case needs data that isn't present) ---
  // Recreate any data you created live so the spec is self-sufficient on re-run.

  // --- Act --- map each step to a page action using the LIVE-VERIFIED selectors
  // (data-testid → getByRole → getByLabel → CSS).
  await page.goto('<real route>');
  await page.getByRole('button', { name: '<real action>' }).click();

  // --- Assert --- one web-first assertion per Expected Result. Auto-waiting
  // only — never page.waitForTimeout(...).
  await expect(page.getByText('<expected result>')).toBeVisible();
});
