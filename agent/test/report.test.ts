/**
 * Unit tests for the `parse_playwright_report` port (`src/report.ts`).
 * Feeds a sample Playwright JSON-reporter report and asserts the flattened
 * per-spec dicts match what the Python original would produce for the same
 * input (status mapping, last-retry-wins, attachment filtering, nested
 * suites, and the spec-filename convention).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlaywrightReport, parseSpecIdentity, specFilename } from "../src/report";

test("maps a passing spec with no attachments", () => {
  const report = {
    suites: [
      {
        file: "1428-TC-01.spec.ts",
        specs: [
          {
            file: "1428-TC-01.spec.ts",
            title: "logs in successfully",
            tests: [
              {
                results: [{ status: "passed", duration: 1234, attachments: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const out = parsePlaywrightReport(report);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    file: "1428-TC-01.spec.ts",
    title: "logs in successfully",
    status: "pass",
    duration_ms: 1234,
    error_message: "",
    attachments: [],
  });
});

test("maps failed/timedOut/interrupted to fail and skipped to skipped", () => {
  const makeSuite = (status: string) => ({
    file: `case-${status}.spec.ts`,
    specs: [
      {
        file: `case-${status}.spec.ts`,
        title: "t",
        tests: [{ results: [{ status, duration: 1, attachments: [] }] }],
      },
    ],
  });
  for (const [input, expected] of [
    ["failed", "fail"],
    ["timedOut", "fail"],
    ["interrupted", "fail"],
    ["skipped", "skipped"],
  ] as const) {
    const out = parsePlaywrightReport({ suites: [makeSuite(input)] });
    assert.equal(out[0].status, expected, `expected ${input} -> ${expected}`);
  }
});

test("unknown status defaults to fail", () => {
  const out = parsePlaywrightReport({
    suites: [
      {
        file: "x.spec.ts",
        specs: [{ file: "x.spec.ts", title: "t", tests: [{ results: [{ status: "weird" }] }] }],
      },
    ],
  });
  assert.equal(out[0].status, "fail");
});

test("uses the LAST retry result for status/duration/error", () => {
  const out = parsePlaywrightReport({
    suites: [
      {
        file: "retry.spec.ts",
        specs: [
          {
            file: "retry.spec.ts",
            title: "flaky then passes",
            tests: [
              {
                results: [
                  { status: "failed", duration: 500, error: { message: "first attempt failed" } },
                  { status: "passed", duration: 900, error: undefined },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(out[0].status, "pass");
  assert.equal(out[0].duration_ms, 900);
  assert.equal(out[0].error_message, "");
});

test("extracts error message from an object and a bare string", () => {
  const withObjectError = parsePlaywrightReport({
    suites: [
      {
        file: "e1.spec.ts",
        specs: [{ file: "e1.spec.ts", title: "t", tests: [{ results: [{ status: "failed", error: { message: "boom" } }] }] }],
      },
    ],
  });
  assert.equal(withObjectError[0].error_message, "boom");

  const withStringError = parsePlaywrightReport({
    suites: [
      {
        file: "e2.spec.ts",
        specs: [{ file: "e2.spec.ts", title: "t", tests: [{ results: [{ status: "failed", error: "plain string" }] }] }],
      },
    ],
  });
  assert.equal(withStringError[0].error_message, "plain string");
});

test("filters attachments to known kinds and drops attachments without a path", () => {
  const out = parsePlaywrightReport({
    suites: [
      {
        file: "att.spec.ts",
        specs: [
          {
            file: "att.spec.ts",
            title: "t",
            tests: [
              {
                results: [
                  {
                    status: "failed",
                    attachments: [
                      { name: "screenshot", path: "/tmp/shot.png" },
                      { name: "video", path: "/tmp/vid.webm" },
                      { name: "trace", path: "/tmp/trace.zip" },
                      { name: "qagent-dom-raw", path: "/tmp/dom.html" },
                      { name: "qagent-dom-distilled", path: "/tmp/dom.json" },
                      { name: "stdout", path: "/tmp/stdout.txt" },
                      { name: "screenshot", path: "" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(out[0].attachments, [
    { kind: "screenshot", path: "/tmp/shot.png" },
    { kind: "video", path: "/tmp/vid.webm" },
    { kind: "trace", path: "/tmp/trace.zip" },
    { kind: "dom", path: "/tmp/dom.html" },
    { kind: "dom-distilled", path: "/tmp/dom.json" },
  ]);
});

test("flattens nested describe-block suites under one file", () => {
  const out = parsePlaywrightReport({
    suites: [
      {
        file: "nested.spec.ts",
        specs: [],
        suites: [
          {
            specs: [{ title: "inner test", tests: [{ results: [{ status: "passed", duration: 5 }] }] }],
          },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "nested.spec.ts");
  assert.equal(out[0].title, "inner test");
});

test("empty results array yields a fail with zero duration", () => {
  const out = parsePlaywrightReport({
    suites: [{ file: "none.spec.ts", specs: [{ file: "none.spec.ts", title: "t", tests: [{ results: [] }] }] }],
  });
  assert.equal(out[0].status, "fail");
  assert.equal(out[0].duration_ms, 0);
});

test("specFilename strips the ticket prefix down to its short suffix", () => {
  assert.equal(specFilename("SUR-1428", "TC-01"), "1428-TC-01.spec.ts");
  assert.equal(specFilename("1428", "TC-02"), "1428-TC-02.spec.ts");
});

test("parseSpecIdentity recovers shortTicket + caseCode from the TC-NN convention", () => {
  assert.deepEqual(parseSpecIdentity("1428-TC-01.spec.ts"), { shortTicket: "1428", caseCode: "TC-01" });
  assert.deepEqual(parseSpecIdentity("weird-name.spec.ts"), { shortTicket: "weird-name", caseCode: "" });
});
