/**
 * Port of `api/app/services/playwright_runner.py`'s config template
 * (`_PLAYWRIGHT_CONFIG_TEMPLATE` + `_write_config`) and the injected-fixtures
 * shim (`_fixtures_ts` + `_apply_fixtures`), reproduced faithfully so a spec
 * that runs on the server and one that runs via the Local Agent behave
 * identically — including always-on DOM capture (raw + distilled).
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
 * TypeScript for a generated `fixtures.ts` that captures the page DOM after
 * every test, and optionally replays a captured sessionStorage — port of
 * `_fixtures_ts`.
 *
 * The module re-exports Playwright's `test` extended with:
 * - an `{auto: true}` fixture that, after each test, best-effort attaches the
 *   live page's raw HTML (`qagent-dom-raw`) and a distilled inventory of the
 *   page's interactable elements (`qagent-dom-distilled`) via `testInfo.attach`,
 *   so self-heal can ground on the real DOM. Wrapped in try/catch so it never
 *   fails a test.
 * - (only when `replaySession`) a `context` override that restores the captured
 *   `sessionStorage` (MSAL/SPA tokens) for the current origin before app code runs.
 *
 * @param sessionFile Absolute path to the captured `sessionStorage.json`;
 *   embedded as a JSON-encoded string literal, read at runtime only when
 *   `replaySession` is set.
 * @param replaySession Whether to inject the sessionStorage-replay `context`
 *   override (DOM capture is always injected regardless).
 */
export function fixturesTs(sessionFile: string, replaySession: boolean): string {
  const contextFixture = replaySession
    ? "  context: async ({ context }, use) => {\n" +
      "    await context.addInitScript((sessions: Record<string, Record<string, string>>) => {\n" +
      "      try {\n" +
      "        const entries = sessions[location.origin];\n" +
      "        if (entries) for (const k in entries) window.sessionStorage.setItem(k, entries[k]);\n" +
      "      } catch {}\n" +
      "    }, SESSIONS);\n" +
      "    await use(context);\n" +
      "  },\n"
    : "";
  return (
    "import { test as base, expect } from '@playwright/test';\n" +
    "import * as fs from 'fs';\n" +
    "\n" +
    `const SESSION_FILE = ${JSON.stringify(sessionFile)};\n` +
    "let SESSIONS: Record<string, Record<string, string>> = {};\n" +
    "try { SESSIONS = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')); } catch {}\n" +
    "\n" +
    "export const test = base.extend<{ _domCapture: void }>({\n" +
    contextFixture +
    "  // Always-on DOM capture: after each test, snapshot the live page so the\n" +
    "  // runner (evidence) and self-heal loop (real selectors) can use it.\n" +
    "  _domCapture: [async ({ page }, use, testInfo) => {\n" +
    "    await use();\n" +
    "    try {\n" +
    "      const raw = await page.content();\n" +
    "      await testInfo.attach('qagent-dom-raw', { body: raw, contentType: 'text/html' });\n" +
    "    } catch {}\n" +
    "    try {\n" +
    "      const snapshot = await page.evaluate(() => {\n" +
    "        const SEL = 'a,button,input,select,textarea,[role],[data-testid],[data-test],[id]';\n" +
    "        const elements = Array.from(document.querySelectorAll(SEL)).slice(0, 400).map((node) => {\n" +
    "          const el = node as HTMLElement;\n" +
    "          const text = (el.innerText || '').trim().slice(0, 80);\n" +
    "          return {\n" +
    "            tag: el.tagName.toLowerCase(),\n" +
    "            role: el.getAttribute('role') || undefined,\n" +
    "            testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,\n" +
    "            id: el.id || undefined,\n" +
    "            name: el.getAttribute('name') || undefined,\n" +
    "            text: text || undefined,\n" +
    "            placeholder: el.getAttribute('placeholder') || undefined,\n" +
    "            type: el.getAttribute('type') || undefined,\n" +
    "          };\n" +
    "        });\n" +
    "        return { path: location.pathname, url: location.href, elements };\n" +
    "      });\n" +
    "      await testInfo.attach('qagent-dom-distilled', {\n" +
    "        body: JSON.stringify(snapshot),\n" +
    "        contentType: 'application/json',\n" +
    "      });\n" +
    "    } catch {}\n" +
    "  }, { auto: true }],\n" +
    "});\n" +
    "\n" +
    "export { expect };\n" +
    "export type * from '@playwright/test';\n"
  );
}

/**
 * Point each spec's Playwright import at the generated `fixtures.ts` and write
 * it — port of `_apply_fixtures`. Only the module specifier is touched.
 *
 * DOM capture is always on, so fixtures are ALWAYS injected (unlike the previous
 * auth-only behavior): each spec's `'@playwright/test'` import is rewritten to
 * `'./fixtures'` and `fixtures.ts` is (re)written every run. `replaySession` only
 * controls whether the generated module also replays the captured sessionStorage.
 *
 * The Python version globs `*.spec.ts` in `specDir`; the agent already knows
 * exactly which spec filenames it wrote for this job, so `specFilenames` is
 * passed explicitly instead of re-scanning the directory.
 *
 * @param specDir The job's local workdir containing the spec files.
 * @param specFilenames The spec filenames written into `specDir` for this job.
 * @param sessionFile Absolute path to the `sessionStorage.json` snapshot embedded
 *   in the generated `fixtures.ts`.
 * @param replaySession Whether sessionStorage replay is active for this run.
 */
export function applyFixtures(
  specDir: string,
  specFilenames: string[],
  sessionFile: string,
  replaySession: boolean
): void {
  const replacements: [string, string][] = [
    ["'@playwright/test'", "'./fixtures'"],
    ['"@playwright/test"', '"./fixtures"'],
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
  fs.writeFileSync(path.join(specDir, "fixtures.ts"), fixturesTs(sessionFile, replaySession), "utf-8");
}
