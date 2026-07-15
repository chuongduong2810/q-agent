/**
 * Tests for the DOM-exploration slice (#338):
 *  - `runExplorationLoop` (runner.ts) with the driver + HTTP client MOCKED
 *    (injected fakes) — asserts the loop stops on `done`, on a server
 *    `stop:budget`, on `maxSteps`, and on repeat detection; that a gated
 *    state-changing action is SKIPPED (not executed); and that finalize is
 *    called with the accumulated discovered/log.
 *  - the new `api.ts` explore client calls with `fetch` mocked (same style as
 *    api.test.ts) — request shape + the decide start-then-poll flow.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as api from "../src/api";
import { AgentConfig } from "../src/config";
import { runExplorationLoop } from "../src/runner";

const cfg: AgentConfig = {
  serverUrl: "http://127.0.0.1:8787",
  deviceToken: "test-token",
  deviceId: 1,
  deviceName: "test-machine",
};

function makeSession(overrides: Partial<api.ExplorationSession> = {}): api.ExplorationSession {
  return {
    sessionId: "S1",
    baseUrl: "https://app.example.com",
    origin: "https://app.example.com",
    target: { ticket: "T1", screen: "Home", goal: "explore home" },
    maxSteps: 5,
    allowStateChanging: true,
    projectKey: "P",
    repo: "r",
    ...overrides,
  };
}

/** A fake driver. By default each `observe` returns a DISTINCT page (so repeat
 * detection never fires); pass `staticObs:true` to return an identical page. */
function makeFakeDriver(opts: { staticObs?: boolean } = {}) {
  let n = 0;
  const acts: Array<{ action: string; args: Record<string, unknown> }> = [];
  let closed = false;
  const driver = {
    observe: async () => {
      const i = opts.staticObs ? 0 : ++n;
      return { ok: true, url: `https://app.example.com/p${i}`, path: `/p${i}`, a11y: { i }, elements: [] };
    },
    act: async (action: string, args: Record<string, unknown>) => {
      acts.push({ action, args });
      return { ok: true, error: null, changed: true };
    },
    close: async () => {
      closed = true;
    },
  };
  return { driver, acts, isClosed: () => closed };
}

/** A fake explore HTTP client that returns scripted decisions in order (the
 * last one repeats if the loop asks for more). Records events + finalize. */
function makeFakeApi(decisions: api.DecideResult[]) {
  let di = 0;
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const finalizeCalls: Array<Record<string, unknown>> = [];
  const client: Pick<typeof api, "postExploreDecide" | "postExploreEvent" | "postExploreFinalize"> = {
    postExploreDecide: async () => decisions[Math.min(di++, decisions.length - 1)],
    postExploreEvent: async (_cfg, _sid, event, payload) => {
      events.push({ event, payload });
    },
    postExploreFinalize: async (_cfg, _sid, body) => {
      finalizeCalls.push(body);
    },
  };
  return { client, events, finalizeCalls, decideCount: () => di };
}

const noopEmit = () => {};

test("loop stops on a `done` action and finalizes with stopReason=done", async () => {
  const { driver, acts, isClosed } = makeFakeDriver();
  const fake = makeFakeApi([
    { action: "click", args: { testId: "menu" }, reasoning: "open menu" },
    { action: "done", args: {}, reasoning: "goal reached" },
  ]);
  await runExplorationLoop(cfg, makeSession(), driver, fake.client, noopEmit);

  assert.equal(fake.finalizeCalls.length, 1);
  const body = fake.finalizeCalls[0];
  assert.equal(body.stopReason, "done");
  assert.equal(body.stepsTaken, 1); // one click executed, then `done` broke the loop
  assert.deepEqual(acts, [{ action: "click", args: { testId: "menu" } }]);
  // Discovered records the selector that worked, with its strategy.
  const discovered = body.discovered as { selectors: Array<Record<string, unknown>> };
  assert.deepEqual(discovered.selectors, [{ action: "click", strategy: "testId", value: "menu" }]);
  assert.ok(isClosed(), "driver.close() should be called");
});

test("loop stops when the server returns stop:true (budget)", async () => {
  const { driver } = makeFakeDriver();
  const fake = makeFakeApi([
    { action: "click", args: { selector: ".a" }, reasoning: "step 1" },
    { action: "noop", args: {}, reasoning: "budget spent", stop: true, stopReason: "budget" },
  ]);
  await runExplorationLoop(cfg, makeSession(), driver, fake.client, noopEmit);

  assert.equal(fake.finalizeCalls[0].stopReason, "budget");
  assert.equal(fake.finalizeCalls[0].stepsTaken, 1);
});

test("loop stops at maxSteps when nothing else stops it", async () => {
  const { driver, acts } = makeFakeDriver();
  const fake = makeFakeApi([{ action: "click", args: { role: "button", name: "Next" }, reasoning: "keep going" }]);
  await runExplorationLoop(cfg, makeSession({ maxSteps: 3 }), driver, fake.client, noopEmit);

  assert.equal(fake.finalizeCalls[0].stopReason, "maxSteps");
  assert.equal(fake.finalizeCalls[0].stepsTaken, 3);
  assert.equal(acts.length, 3);
});

test("loop stops on repeat detection (same url + a11y signature)", async () => {
  const { driver } = makeFakeDriver({ staticObs: true });
  const fake = makeFakeApi([{ action: "click", args: { selector: ".x" }, reasoning: "click" }]);
  await runExplorationLoop(cfg, makeSession(), driver, fake.client, noopEmit);

  assert.equal(fake.finalizeCalls[0].stopReason, "repeat");
  assert.equal(fake.finalizeCalls[0].stepsTaken, 1); // first step ran, second observe repeated
});

test("a gated state-changing action is SKIPPED, not executed", async () => {
  const { driver, acts } = makeFakeDriver();
  const fake = makeFakeApi([{ action: "click", args: { testId: "buy" }, reasoning: "attempt purchase" }]);
  await runExplorationLoop(cfg, makeSession({ maxSteps: 1, allowStateChanging: false }), driver, fake.client, noopEmit);

  assert.equal(acts.length, 0, "driver.act must not be called for a gated action");
  const body = fake.finalizeCalls[0];
  const log = body.log as Array<Record<string, unknown>>;
  const clickEntry = log.find((e) => e.action === "click");
  assert.ok(clickEntry, "the skipped action is still recorded in the log");
  assert.equal(clickEntry?.skipped, true);
  // Nothing was actually exercised, so no discovery is recorded.
  const discovered = body.discovered as { routes: unknown[]; selectors: unknown[] };
  assert.equal(discovered.selectors.length, 0);
});

test("goto action records the route in discovered", async () => {
  const { driver } = makeFakeDriver();
  const fake = makeFakeApi([
    { action: "goto", args: { url: "/settings" }, reasoning: "navigate" },
    { action: "done", args: {}, reasoning: "done" },
  ]);
  await runExplorationLoop(cfg, makeSession(), driver, fake.client, noopEmit);
  const discovered = fake.finalizeCalls[0].discovered as { routes: unknown[] };
  assert.deepEqual(discovered.routes, ["/settings"]);
});

test("progress is emitted via both postExploreEvent and the local bus", async () => {
  const { driver } = makeFakeDriver();
  const fake = makeFakeApi([
    { action: "click", args: { testId: "a" }, reasoning: "r" },
    { action: "done", args: {}, reasoning: "done" },
  ]);
  const emitted: Array<{ type: string; data?: Record<string, unknown> }> = [];
  await runExplorationLoop(cfg, makeSession(), driver, fake.client, (type, data) => emitted.push({ type, data }));

  assert.equal(fake.events.length, 1);
  assert.equal(fake.events[0].event, "explore.progress");
  assert.ok(emitted.some((e) => e.type === "explore-progress"));
  assert.ok(emitted.some((e) => e.type === "explore-complete"));
});

// ── api.ts explore client (fetch mocked) ──────────────────────────────────

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

test("claimNextExploration returns null on 204", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  const s = await api.claimNextExploration(cfg);
  assert.equal(s, null);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/explore/next");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-token");
});

test("claimNextExploration returns the parsed session on 200", async () => {
  const payload = makeSession();
  mockFetch(() => Response.json(payload));
  const s = await api.claimNextExploration(cfg);
  assert.deepEqual(s, payload);
});

test("postExploreDecide starts a job then polls decide/{jobId} for the result", async () => {
  mockFetch((url, init) => {
    if (init.method === "POST") return Response.json({ jobId: "d-1", status: "running" });
    return Response.json({ status: "done", result: { action: "click", args: { testId: "x" }, reasoning: "r" } });
  });
  const out = await api.postExploreDecide(cfg, "S1", {
    observation: { accessibility: {}, elements: [], url: "https://app/x", path: "/x" },
    history: [],
    stepsTaken: 0,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/explore/S1/decide");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "http://127.0.0.1:8787/agent/explore/S1/decide/d-1");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(out.action, "click");
});

test("postExploreDecide surfaces a server-side error job", async () => {
  mockFetch((url, init) => {
    if (init.method === "POST") return Response.json({ jobId: "d-2", status: "running" });
    return Response.json({ status: "error", error: "budget exhausted before start" });
  });
  await assert.rejects(
    () =>
      api.postExploreDecide(cfg, "S1", {
        observation: { accessibility: {}, elements: [], url: "u", path: "/" },
        history: [],
        stepsTaken: 0,
      }),
    /budget exhausted/
  );
});

test("postExploreEvent wraps event+payload", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postExploreEvent(cfg, "S1", "explore.progress", { step: 1 });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/explore/S1/events");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { event: "explore.progress", payload: { step: 1 } });
});

test("postExploreFinalize posts the accumulated discovery", async () => {
  mockFetch(() => new Response(null, { status: 200 }));
  await api.postExploreFinalize(cfg, "S1", {
    discovered: { routes: ["/x"], selectors: [] },
    log: [],
    stopReason: "done",
    stepsTaken: 2,
  });
  assert.equal(calls[0].url, "http://127.0.0.1:8787/agent/explore/S1/finalize");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.stopReason, "done");
  assert.equal(body.stepsTaken, 2);
});
