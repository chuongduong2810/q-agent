/**
 * Mocked-fetch tests for the wire-protocol client (`src/api.ts`) — verifies
 * the agent builds correct requests (method, auth header, body shape) for
 * claim/results/evidence without needing a live server.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as api from "../src/api";
import { AgentConfig } from "../src/config";

const cfg: AgentConfig = {
  serverUrl: "http://127.0.0.1:8787",
  deviceToken: "test-token",
  deviceId: 1,
  deviceName: "test-machine",
};

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init: init ?? {} });
    return handler(u, init ?? {});
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
});

test("claimNextJob returns null on 204 (no queued job)", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  const job = await api.claimNextJob(cfg);
  assert.equal(job, null);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/jobs/next");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-token");
  assert.equal(calls[0].init.method, "POST");
});

test("claimNextJob returns the parsed job payload on 200", async () => {
  const payload = {
    executionId: 42,
    runCode: "RUN-1",
    env: "Staging",
    browser: "chromium",
    workers: 2,
    headless: true,
    baseUrl: "https://app.example.com",
    manualAuth: true,
    authOrigins: ["https://app.example.com"],
    specs: [{ filename: "1428-TC-01.spec.ts", code: "// spec" }],
  };
  mockFetch(() => Response.json(payload));
  const job = await api.claimNextJob(cfg);
  assert.deepEqual(job, payload);
});

test("claimNextJob throws ApiError on a non-ok, non-204 response", async () => {
  mockFetch(() => new Response("nope", { status: 500 }));
  await assert.rejects(() => api.claimNextJob(cfg), api.ApiError);
});

test("postResult sends the parsed-report shape as JSON", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postResult(cfg, 42, { file: "1428-TC-01.spec.ts", status: "pass", duration_ms: 900, error_message: "" });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/jobs/42/results");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { file: "1428-TC-01.spec.ts", status: "pass", duration_ms: 900, error_message: "" });
});

test("postEvent wraps event+payload", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postEvent(cfg, 42, "exec.auth.waiting", { url: "https://app.example.com" });
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { event: "exec.auth.waiting", payload: { url: "https://app.example.com" } });
});

test("postEvidence sends a multipart form with the right fields", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpFile = path.join(os.tmpdir(), `qagent-test-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, "fake-png-bytes");

  mockFetch(() => new Response(null, { status: 200 }));
  await api.postEvidence(cfg, 42, {
    ticketExternalId: "SUR-1428",
    caseCode: "TC-01",
    kind: "screenshot",
    filePath: tmpFile,
    filename: "shot.png",
  });
  fs.rmSync(tmpFile);

  const init = calls[0].init;
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/jobs/42/evidence");
  assert.ok(init.body instanceof FormData);
  const form = init.body as FormData;
  assert.equal(form.get("ticket_external_id"), "SUR-1428");
  assert.equal(form.get("case_code"), "TC-01");
  assert.equal(form.get("kind"), "screenshot");
  assert.ok(form.get("file") instanceof Blob);
});

test("postComplete sends the aggregate body", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postComplete(cfg, 42, { passed: 3, failed: 1, log: "tail" });
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { passed: 3, failed: 1, log: "tail" });
});

test("postHealFix posts the attempt to /agent/heal/{caseId}/fix and returns the action", async () => {
  mockFetch(() => Response.json({ action: "fixed", code: "// fixed", diff: "@@" }));
  const out = await api.postHealFix(cfg, 99, {
    currentCode: "// old", error: "boom", output: "tail", domDistilled: { path: "/x" }, attempt: 2,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/heal/99/fix");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { currentCode: "// old", error: "boom", output: "tail", domDistilled: { path: "/x" }, attempt: 2 });
  assert.equal(out.action, "fixed");
  assert.equal(out.code, "// fixed");
});

test("postHealFinalize posts the outcome to /agent/heal/{caseId}/finalize", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postHealFinalize(cfg, 99, { finalStatus: "pass", finalCode: "// x", attempts: [] });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/heal/99/finalize");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.finalStatus, "pass");
});

test("redeemDevice posts code+name with no auth header", async () => {
  mockFetch(() => Response.json({ deviceToken: "abc", deviceId: 7 }));
  const result = await api.redeemDevice("http://127.0.0.1:8787", "PAIR123", "my-laptop");
  assert.deepEqual(result, { deviceToken: "abc", deviceId: 7 });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/devices/redeem");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { code: "PAIR123", name: "my-laptop" });
});

test("fetchWithTimeout aborts a stalled request once the timeout elapses", async () => {
  // A server that never responds but honors the abort signal.
  mockFetch(
    (_u, init) =>
      new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  await assert.rejects(api.fetchWithTimeout("http://127.0.0.1:8787/slow", { method: "POST" }, 20));
});

test("fetchWithTimeout returns the response when it resolves before the timeout", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  const res = await api.fetchWithTimeout("http://127.0.0.1:8787/ok", {}, 1000);
  assert.equal(res.status, 200);
});
