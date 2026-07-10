/**
 * Port of `api/app/services/playwright_runner.py`'s config template
 * (`_PLAYWRIGHT_CONFIG_TEMPLATE` + `_write_config`) and the sessionStorage
 * fixture shim (`_auth_fixtures_ts` + `_apply_auth_fixtures`), reproduced
 * faithfully so a spec that runs on the server and one that runs via the
 * Local Agent behave identically.
 */

import * as fs from "fs";
import * as path from "path";

const PLAYWRIGHT_CONFIG_TEMPLATE = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  workers: __WORKERS__,
  reporter: [['json', { outputFile: 'report.json' }]],
  use: {
    headless: __HEADLESS__,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
__EXTRA_USE__  },
});
`;

/**
 * (Re)write `playwright.config.ts` into `specDir` — same shape as the
 * server's `_write_config`.
 *
 * @param specDir The job's local workdir the config is written into.
 * @param workers Parallel worker count.
 * @param headless Whether the browser runs headless.
 * @param baseUrl When non-empty, injected as `use.baseURL`.
 * @param storageState When non-empty, an absolute path injected as `use.storageState`.
 */
export function writeConfig(
  specDir: string,
  workers: number,
  headless: boolean,
  baseUrl = "",
  storageState = ""
): void {
  const extraLines: string[] = [];
  if (baseUrl) extraLines.push(`    baseURL: ${JSON.stringify(baseUrl)},`);
  if (storageState) extraLines.push(`    storageState: ${JSON.stringify(storageState)},`);
  const extraUse = extraLines.length ? extraLines.join("\n") + "\n" : "";
  const content = PLAYWRIGHT_CONFIG_TEMPLATE.replace("__WORKERS__", String(workers))
    .replace("__HEADLESS__", headless ? "true" : "false")
    .replace("__EXTRA_USE__", extraUse);
  fs.writeFileSync(path.join(specDir, "playwright.config.ts"), content, "utf-8");
}

/**
 * TypeScript for a generated `fixtures.ts` that replays sessionStorage —
 * port of `_auth_fixtures_ts`.
 *
 * @param sessionFile Absolute path to the captured `sessionStorage.json`;
 *   embedded as a JSON-encoded string literal so the fixture reads it at
 *   runtime.
 */
export function authFixturesTs(sessionFile: string): string {
  return (
    "import { test as base, expect } from '@playwright/test';\n" +
    "import * as fs from 'fs';\n" +
    "\n" +
    `const SESSION_FILE = ${JSON.stringify(sessionFile)};\n` +
    "let SESSIONS: Record<string, Record<string, string>> = {};\n" +
    "try { SESSIONS = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')); } catch {}\n" +
    "\n" +
    "export const test = base.extend({\n" +
    "  context: async ({ context }, use) => {\n" +
    "    await context.addInitScript((sessions: Record<string, Record<string, string>>) => {\n" +
    "      try {\n" +
    "        const entries = sessions[location.origin];\n" +
    "        if (entries) for (const k in entries) window.sessionStorage.setItem(k, entries[k]);\n" +
    "      } catch {}\n" +
    "    }, SESSIONS);\n" +
    "    await use(context);\n" +
    "  },\n" +
    "});\n" +
    "\n" +
    "export { expect };\n" +
    "export type * from '@playwright/test';\n"
  );
}

/**
 * Rewrite each spec's Playwright import to use (or stop using) the
 * sessionStorage fixture — port of `_apply_auth_fixtures`. Only the module
 * specifier is touched.
 *
 * The Python version globs `*.spec.ts` in `specDir`; the agent already
 * knows exactly which spec filenames it wrote for this job, so
 * `specFilenames` is passed explicitly instead of re-scanning the
 * directory (equivalent behavior, no extra glob dependency).
 *
 * @param specDir The job's local workdir containing the spec files.
 * @param specFilenames The spec filenames written into `specDir` for this job.
 * @param sessionFile Absolute path to the `sessionStorage.json` snapshot embedded
 *   in the generated `fixtures.ts`.
 * @param enabled Whether sessionStorage replay is active for this run.
 */
export function applyAuthFixtures(
  specDir: string,
  specFilenames: string[],
  sessionFile: string,
  enabled: boolean
): void {
  const replacements: [string, string][] = enabled
    ? [
        ["'@playwright/test'", "'./fixtures'"],
        ['"@playwright/test"', '"./fixtures"'],
      ]
    : [
        ["'./fixtures'", "'@playwright/test'"],
        ['"./fixtures"', '"@playwright/test"'],
      ];
  for (const filename of specFilenames) {
    const specPath = path.join(specDir, filename);
    let text: string;
    try {
      text = fs.readFileSync(specPath, "utf-8");
    } catch {
      continue;
    }
    let newText = text;
    for (const [oldStr, newStr] of replacements) {
      newText = newText.split(oldStr).join(newStr);
    }
    if (newText !== text) {
      fs.writeFileSync(specPath, newText, "utf-8");
    }
  }
  if (enabled) {
    fs.writeFileSync(path.join(specDir, "fixtures.ts"), authFixturesTs(sessionFile), "utf-8");
  }
}
