/**
 * Port of `api/app/services/playwright_runner.py`'s `parse_playwright_report`
 * (and the `spec_service.spec_filename` convention it depends on) — kept
 * byte-for-byte faithful to the Python behavior so a report produced by the
 * agent's local Playwright run maps to the exact same per-spec shape the
 * server already understands.
 */

/** One parsed attachment from a Playwright test result. */
export interface ParsedAttachment {
  kind: string;
  path: string;
}

/** One flattened per-spec result, matching `parse_playwright_report`'s output dict. */
export interface ParsedResult {
  file: string;
  title: string;
  status: "pass" | "fail" | "skipped";
  duration_ms: number;
  error_message: string;
  attachments: ParsedAttachment[];
}

const STATUS_MAP: Record<string, "pass" | "fail" | "skipped"> = {
  passed: "pass",
  failed: "fail",
  timedOut: "fail",
  interrupted: "fail",
  skipped: "skipped",
};

/** Normalize a raw Playwright test status to the server's vocabulary — shared by
 * the batch report parse and the live per-test reporter stream so both agree. */
export function normalizeStatus(pwStatus: string): "pass" | "fail" | "skipped" {
  return STATUS_MAP[pwStatus] ?? "fail";
}

// Evidence kind values a Playwright attachment `name` can map to.
const ATTACHMENT_KIND_MAP: Record<string, string> = {
  screenshot: "screenshot",
  video: "video",
  trace: "trace",
  // DOM captured by the injected fixtures (see playwrightConfig.fixturesTs):
  // raw page HTML + a distilled interactable-element inventory.
  "qagent-dom-raw": "dom",
  "qagent-dom-distilled": "dom-distilled",
  // Console + network captured by the fixtures (#456): uploaded via the evidence
  // path but decoded server-side into console_logs/network_logs (not media rows).
  "qagent-console": "console",
  "qagent-network": "network",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
interface PlaywrightTestResult {
  status?: string;
  duration?: number;
  error?: { message?: string } | string;
  attachments?: { name?: string; path?: string }[];
}

interface PlaywrightSpec {
  file?: string;
  title?: string;
  tests?: { results?: PlaywrightTestResult[] }[];
}

interface PlaywrightSuite {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

export interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Map a Playwright JSON-reporter report to per-spec result dicts.
 *
 * Nested suites (Playwright groups specs per file, and can nest describe
 * blocks) are flattened. If a test was retried, the LAST result is used to
 * determine final status/duration/error, matching what the Playwright UI
 * reports as the outcome — same semantics as the Python `parse_playwright_report`.
 *
 * @param report Parsed contents of Playwright's `--reporter=json` output.
 * @returns One entry per test spec.
 */
export function parsePlaywrightReport(report: PlaywrightReport): ParsedResult[] {
  const out: ParsedResult[] = [];

  function walk(suite: PlaywrightSuite, fileHint: string): void {
    const fileName = suite.file || fileHint;
    for (const spec of suite.specs || []) {
      const specFile = spec.file || fileName;
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results.length ? results[results.length - 1] : ({} as PlaywrightTestResult);
        const status = STATUS_MAP[last.status || ""] ?? "fail";
        const error = last.error;
        const errorMessage =
          error && typeof error === "object" ? error.message || "" : typeof error === "string" ? error : "";
        const attachments: ParsedAttachment[] = (last.attachments || [])
          .filter((a) => a.name !== undefined && a.name in ATTACHMENT_KIND_MAP && !!a.path)
          .map((a) => ({ kind: ATTACHMENT_KIND_MAP[a.name as string], path: a.path as string }));
        out.push({
          file: specFile,
          title: spec.title || "",
          status,
          duration_ms: Math.trunc(last.duration || 0),
          error_message: errorMessage,
          attachments,
        });
      }
    }
    for (const child of suite.suites || []) {
      walk(child, fileName);
    }
  }

  for (const topSuite of report.suites || []) {
    walk(topSuite, topSuite.file || "");
  }

  return out;
}

/**
 * Build the on-disk spec filename for a case — port of
 * `spec_service.spec_filename`.
 *
 * @param ticketExternalId e.g. "SUR-1428".
 * @param caseCode e.g. "TC-01".
 * @returns A filename like "1428-TC-01.spec.ts".
 */
export function specFilename(ticketExternalId: string, caseCode: string): string {
  const parts = ticketExternalId.split("-");
  const shortTicket = parts[parts.length - 1];
  return `${shortTicket}-${caseCode}.spec.ts`;
}

/**
 * Best-effort reverse of `specFilename`: recover `{shortTicket, caseCode}`
 * from a filename, assuming the fixed `TC-NN` case-code convention used
 * everywhere else in this codebase (`ai_service.py` `_next_case_code`).
 *
 * NOTE: this only recovers the short numeric suffix of the ticket id (e.g.
 * "1428"), not its full provider-prefixed external id (e.g. "SUR-1428") —
 * the `/agent/jobs/next` payload does not currently include that (see
 * README "Known limitation"). Callers should prefer explicit
 * `ticketExternalId`/`caseCode` fields on the job spec when present, and
 * only fall back to this parse otherwise.
 *
 * @param filename e.g. "1428-TC-01.spec.ts".
 */
export function parseSpecIdentity(filename: string): { shortTicket: string; caseCode: string } {
  const base = filename.replace(/\.spec\.ts$/, "");
  const match = /^(.+)-(TC-\d+)$/.exec(base);
  if (match) {
    return { shortTicket: match[1], caseCode: match[2] };
  }
  return { shortTicket: base, caseCode: "" };
}
