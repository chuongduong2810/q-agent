/**
 * Unit tests for the injected-fixtures port (`src/playwrightConfig.ts`).
 * Mirrors the server's `test_fixtures_ts_contents` / `test_apply_fixtures_always_injects`
 * (api/tests/test_execution.py) so the agent's DOM capture stays in lock-step
 * with the server runner.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { applyFixtures, fixturesTs } from "../src/playwrightConfig";

test("fixturesTs always wires DOM capture; sessionStorage replay is gated", () => {
  const sessionFile = "/tmp/sessionStorage.json";

  const replay = fixturesTs(sessionFile, true);
  assert.ok(replay.includes("export const test"));
  assert.ok(replay.includes("testInfo.attach('qagent-dom-raw'"));
  assert.ok(replay.includes("testInfo.attach('qagent-dom-distilled'"));
  assert.ok(replay.includes(JSON.stringify(sessionFile)));
  assert.ok(replay.includes("addInitScript"), "replay=true injects the session init script");

  const noReplay = fixturesTs(sessionFile, false);
  assert.ok(noReplay.includes("testInfo.attach('qagent-dom-distilled'"));
  assert.ok(!noReplay.includes("addInitScript"), "replay=false drops the session init script");
});

test("applyFixtures always rewrites imports to './fixtures' + writes fixtures.ts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-fx-"));
  const specName = "1428-TC-01.spec.ts";
  const specPath = path.join(dir, specName);
  const original =
    "import { test, expect } from '@playwright/test';\n" +
    "test('x', async ({ page }) => { await page.goto('/'); });\n";
  fs.writeFileSync(specPath, original, "utf-8");
  const sessionFile = path.join(dir, "sessionStorage.json");

  // Even without session replay, DOM capture means fixtures are injected.
  applyFixtures(dir, [specName], sessionFile, false);
  const rewritten = fs.readFileSync(specPath, "utf-8");
  assert.ok(rewritten.includes("'./fixtures'"));
  assert.ok(!rewritten.includes("'@playwright/test'"));
  const fixtures = fs.readFileSync(path.join(dir, "fixtures.ts"), "utf-8");
  assert.ok(fixtures.includes("qagent-dom-distilled"));
  assert.ok(!fixtures.includes("addInitScript"));

  // With replay enabled, the init script is added; specs stay pointed at './fixtures'.
  applyFixtures(dir, [specName], sessionFile, true);
  assert.ok(fs.readFileSync(specPath, "utf-8").includes("'./fixtures'"));
  assert.ok(fs.readFileSync(path.join(dir, "fixtures.ts"), "utf-8").includes("addInitScript"));

  fs.rmSync(dir, { recursive: true, force: true });
});
