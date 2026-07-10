import { test, expect, type Page } from "@playwright/test";

/**
 * Product-tour + Getting Started e2e. Runs against the stack booted by
 * playwright.config.ts (QAGENT_AUTH_REQUIRED=true, seeded admin, throwaway
 * SQLite). Proves: the tour auto-starts on a first visit, walks across global
 * routes, seeds + dives into the sample run (all pipeline stages), finishes and
 * persists the seen flag (no re-nag on reload), and re-launches from ⌘K. Also
 * screenshots the Getting Started page.
 */

const ADMIN = { email: "admin@qagent.local", password: "Admin!23456" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN.email);
  await page.locator('input[type="password"]').first().fill(ADMIN.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Advance the tour until the coach-mark shows `title`, clicking Next each step.
 * All queries are scoped to the coach-mark card (`data-testid="tour-card"`) so
 * they never collide with same-named page buttons (e.g. the Tickets pagination
 * "Next"). Waits for the card to settle to exactly one first (AnimatePresence
 * keeps the exiting card mid-transition; cross-route steps briefly unmount it). */
async function nextUntil(page: Page, title: RegExp, maxClicks = 16): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    const card = page.getByTestId("tour-card");
    await expect(card).toHaveCount(1);
    if (await card.getByText(title).isVisible().catch(() => false)) return;
    await card.getByRole("button", { name: /^(Next|Finish)$/ }).click();
  }
  await expect(page.getByTestId("tour-card").getByText(title)).toBeVisible();
}

test("tour auto-starts, seeds a sample run, and completes", async ({ page }) => {
  await signIn(page);

  // Auto-start (fresh context → no qagent.tourSeen): the welcome card appears.
  const card = page.getByTestId("tour-card");
  await expect(card.getByText(/1 of \d+/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Skip" })).toBeVisible();

  // Global cross-route step: reaching Tickets highlights the synced-tickets nav.
  await nextUntil(page, /Your synced tickets/);
  await expect(page).toHaveURL(/\/tickets/);

  // The bridge seeds the sample run and dives into its Review stage (live run).
  await nextUntil(page, /Review Center/);
  await expect(page).toHaveURL(/\/runs\/\d+\/review/);

  // Later pipeline stages are reachable inside the seeded run.
  await nextUntil(page, /Evidence for every case/);
  await expect(page).toHaveURL(/\/runs\/\d+\/evidence/);

  // Finish → overlay closes and the seen flag persists.
  await nextUntil(page, /You're all set/);
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);
  const seen = await page.evaluate(() => localStorage.getItem("qagent.tourSeen"));
  expect(seen).toBe("1");

  // Reload → no auto-start (not nagged again).
  await page.reload();
  await page.waitForTimeout(1200);
  await expect(card).toHaveCount(0);

  // Re-launch from the command palette.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/search/i).fill("product tour");
  await page.getByText(/Start product tour/i).click();
  await expect(card.getByText(/Welcome to/)).toBeVisible();
});

test("Explore the sample run opens a fully-populated run", async ({ page }) => {
  // Suppress the auto-start tour so its click-blocker doesn't intercept clicks.
  await page.addInitScript(() => localStorage.setItem("qagent.tourSeen", "1"));
  await signIn(page);

  // Drive the real UI (uses the app's auth-carrying API client) to seed + open it.
  await page.goto("/getting-started");
  await page.getByRole("button", { name: /Explore the sample run/i }).first().click();
  await expect(page).toHaveURL(/\/runs\/\d+/);
  await expect(page.locator("main")).toBeVisible();

  // The Evidence stage should render its screen (artifacts were seeded on disk).
  const runUrl = new URL(page.url());
  await page.goto(`${runUrl.pathname}/evidence`);
  await expect(page.locator("main")).toBeVisible();
});

test("Getting Started page renders with CTAs", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qagent.tourSeen", "1"));
  await signIn(page);
  await page.goto("/getting-started");
  await expect(page.getByRole("heading", { name: /Getting Started/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Take the product tour/i }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Explore the sample run/i }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "e2e-getting-started.png", fullPage: true });
});
