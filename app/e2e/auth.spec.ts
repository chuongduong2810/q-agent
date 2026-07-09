import { test, expect, request as pwRequest, type Page } from "@playwright/test";

/**
 * Auth vertical e2e (ADR 0007, issue #79). Runs against the stack booted by
 * playwright.config.ts with QAGENT_AUTH_REQUIRED=true. Proves: guard redirects
 * an anonymous visitor to /login; the seeded admin can log in, reach the app,
 * and log out to /signed-out; the admin reaches user management while a member
 * is blocked from it.
 */

const API = "http://127.0.0.1:8787";
const ADMIN = { email: "admin@qagent.local", password: "Admin!23456" };
const MEMBER = { email: "member@qagent.local", password: "Member!23456" };

/** Create the member via the API (idempotent) so the block test has a subject. */
async function ensureMember(): Promise<void> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  try {
    const res = await ctx.post("/auth/login", { data: ADMIN });
    const token = (await res.json()).accessToken as string;
    await ctx.post("/auth/users", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        email: MEMBER.email,
        firstName: "Mel",
        lastName: "Member",
        role: "member",
        password: MEMBER.password,
      },
    });
    // 201 created, or 400/409 if it already exists from a prior run — both fine.
  } finally {
    await ctx.dispose();
  }
}

async function signIn(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("anonymous visitor is redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("admin can log in, reach the app, and log out", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/localhost:5173\/?$/);

  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/signed-out$/);
});

test("admin can open user management", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/settings/users");
  await expect(page.getByText(/not authorized/i)).toHaveCount(0);
});

test("member is blocked from user management", async ({ page }) => {
  await ensureMember();
  await signIn(page, MEMBER);
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: /not authorized/i })).toBeVisible();
});
