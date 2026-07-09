import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";

/**
 * E2E for the auth vertical (ADR 0007). Boots the API with enforcement ON
 * (`QAGENT_AUTH_REQUIRED=true`) + a seeded admin against a throwaway SQLite DB,
 * plus the Vite dev server (whose `/auth` proxy makes the httpOnly refresh/CSRF
 * cookies same-origin). Run: `npm run test:e2e` (chromium must be installed
 * once via `npx playwright install chromium`).
 */

const API_PORT = 8787;
const WEB_PORT = 5173;
const E2E_DB = path.join(os.tmpdir(), "qagent-e2e-auth.db").replace(/\\/g, "/");

const API_ENV: Record<string, string> = {
  QAGENT_AUTH_REQUIRED: "true",
  QAGENT_COOKIE_SECURE: "false",
  QAGENT_SECRET_KEY: "e2e-secret-key",
  QAGENT_ADMIN_EMAIL: "admin@qagent.local",
  QAGENT_ADMIN_PASSWORD: "Admin!23456",
  QAGENT_DATABASE_URL: `sqlite:///${E2E_DB}`,
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "uv run uvicorn app.main:app --port 8787",
      cwd: path.resolve(process.cwd(), "../api"),
      port: API_PORT,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: API_ENV,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      port: WEB_PORT,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
