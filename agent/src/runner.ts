/**
 * The job loop: claim a queued execution, run it locally with Playwright,
 * and push progress/results/evidence back to the server. Faithful port of
 * `api/app/services/playwright_runner.py`'s `run_execution`, with DB writes
 * and `hub.publish` WS events replaced by the `/agent/jobs/*` HTTP calls
 * (`api.ts`).
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as api from "./api";
import { AgentConfig } from "./config";
import { ensureChromium } from "./ensureBrowser";
import { applyAuthFixtures, writeConfig } from "./playwrightConfig";
import { ParsedResult, parsePlaywrightReport, parseSpecIdentity } from "./report";
import { hasSessionStorage, hasValidSession, sessionPathsForOrigin } from "./session";

// Mirrors api/app/config.py's Settings.exec_timeout_s / auth_capture_timeout_s.
const EXEC_TIMEOUT_MS = 600_000;
const AUTH_CAPTURE_TIMEOUT_MS = 300_000;
const IDLE_POLL_MS = 3_000;

let activeChild: ChildProcess | null = null;

/** Kill whatever child process (capture browser or Playwright run) is active. Used by the CLI's SIGINT handler. */
export function killActiveChild(): void {
  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill();
    } catch {
      // Already gone.
    }
  }
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Resolve the vendored capture_auth.cjs, whether running from `dist/` or via ts-node from `src/`. */
function vendorCaptureScript(): string {
  const found = firstExisting([
    path.join(__dirname, "..", "..", "vendor", "capture_auth.cjs"),
    path.join(__dirname, "..", "vendor", "capture_auth.cjs"),
  ]);
  if (!found) throw new Error("capture_auth.cjs not found — the agent package is missing vendor/");
  return found;
}

/** The agent package's own node_modules, where @playwright/test + playwright are installed. */
function agentNodeModules(): string {
  return (
    firstExisting([path.join(__dirname, "..", "..", "node_modules"), path.join(__dirname, "..", "node_modules")]) ??
    path.join(__dirname, "..", "..", "node_modules")
  );
}

function nodePathEnv(nm: string): NodeJS.ProcessEnv {
  const existing = process.env.NODE_PATH;
  return { ...process.env, NODE_PATH: existing ? `${nm}${path.delimiter}${existing}` : nm };
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, shell: process.platform === "win32" });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    const finish = (code: number | null) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      resolve({ code, stdout, stderr, timedOut });
    };
    child.on("close", finish);
    child.on("error", () => finish(null));
  });
}

/**
 * Open a HEADED browser for manual login (port of
 * `playwright_runner.py`'s `_capture_once`, vendored verbatim as
 * `vendor/capture_auth.cjs`). Returns true only once `storageStatePath` is
 * non-empty after the browser closes.
 */
async function captureAuth(baseUrl: string, storageStatePath: string, sessionStoragePath: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
  const script = vendorCaptureScript();
  const nm = agentNodeModules();
  const result = await runProcess(
    "node",
    [script, baseUrl, storageStatePath, sessionStoragePath],
    nm,
    nodePathEnv(nm),
    AUTH_CAPTURE_TIMEOUT_MS
  );
  if (result.code !== 0) {
    console.error(`Auth capture exited ${result.code}: ${(result.stderr || result.stdout || "").slice(0, 800)}`);
  }
  try {
    return fs.statSync(storageStatePath).size > 0;
  } catch {
    return false;
  }
}

/** Prefer the agent's own installed `playwright` binary over a fresh `npx` fetch. */
function playwrightCommand(): { cmd: string; baseArgs: string[] } {
  const nm = agentNodeModules();
  const bin = path.join(nm, ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");
  if (fs.existsSync(bin)) return { cmd: bin, baseArgs: ["test"] };
  return { cmd: "npx", baseArgs: ["playwright", "test"] };
}

async function runPlaywright(workDir: string, workers: number, specFile: string): Promise<ProcResult> {
  const { cmd, baseArgs } = playwrightCommand();
  const args = [...baseArgs, `--workers=${workers}`];
  if (specFile) args.push(specFile);
  const nm = agentNodeModules();
  return runProcess(cmd, args, workDir, nodePathEnv(nm), EXEC_TIMEOUT_MS);
}

/**
 * Best identity `{ticket, caseCode}` for wire events: prefers explicit
 * fields on the job spec (forward-compatible with a server patch that adds
 * them), falling back to parsing the filename convention otherwise. See
 * README "Known limitation" — the fallback only recovers the ticket's
 * short numeric suffix, not its full provider-prefixed external id.
 */
function identityFor(spec: api.JobSpec): { ticket: string; caseCode: string } {
  if (spec.ticketExternalId && spec.caseCode) {
    return { ticket: spec.ticketExternalId, caseCode: spec.caseCode };
  }
  const parsed = parseSpecIdentity(spec.filename);
  return { ticket: spec.ticketExternalId || parsed.shortTicket, caseCode: spec.caseCode || parsed.caseCode };
}

/** Mark every spec in the job failed with `message` and finalize — used when a run cannot proceed (e.g. manual login was not completed). */
async function failAllResults(cfg: AgentConfig, job: api.Job, message: string): Promise<void> {
  for (const spec of job.specs) {
    const { ticket, caseCode } = identityFor(spec);
    await api
      .postResult(cfg, job.executionId, { file: spec.filename, status: "fail", duration_ms: 0, error_message: message })
      .catch((err) => console.error("postResult failed:", err));
    await api
      .postEvent(cfg, job.executionId, "exec.case.result", { ticket, caseCode, status: "fail", durationMs: 0 })
      .catch((err) => console.error("postEvent failed:", err));
  }
  const total = job.specs.length;
  await api.postComplete(cfg, job.executionId, { passed: 0, failed: total, log: message }).catch((err) =>
    console.error("postComplete failed:", err)
  );
}

/** Process one claimed job end-to-end: write specs/config, resolve auth, run Playwright, push results. */
export async function processJob(cfg: AgentConfig, job: api.Job): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qagent-"));
  try {
    for (const spec of job.specs) {
      fs.writeFileSync(path.join(workDir, spec.filename), spec.code, "utf-8");
    }

    // ---- Resolve auth: reuse a valid local session, or capture one headed.
    let storageState = "";
    let sessionStoragePath = "";
    if (job.manualAuth) {
      let origin = job.authOrigins[0] || "";
      if (!origin && job.baseUrl) {
        try {
          origin = new URL(job.baseUrl).origin;
        } catch {
          origin = "";
        }
      }
      if (origin && hasValidSession(origin)) {
        const paths = sessionPathsForOrigin(origin);
        storageState = paths.storageStatePath;
        sessionStoragePath = paths.sessionStoragePath;
      } else if (origin && job.baseUrl) {
        const paths = sessionPathsForOrigin(origin);
        await api.postEvent(cfg, job.executionId, "exec.auth.waiting", { url: job.baseUrl });
        const captured = await captureAuth(job.baseUrl, paths.storageStatePath, paths.sessionStoragePath);
        if (captured) {
          storageState = paths.storageStatePath;
          sessionStoragePath = paths.sessionStoragePath;
          await api.postEvent(cfg, job.executionId, "exec.auth.captured", {});
        } else {
          const message = "Manual login was not completed — enable/redo login capture";
          await api.postEvent(cfg, job.executionId, "exec.auth.error", { message });
          await failAllResults(cfg, job, message);
          return;
        }
      } else {
        const message = "Set a base URL for the project first.";
        await api.postEvent(cfg, job.executionId, "exec.auth.error", { message });
        await failAllResults(cfg, job, message);
        return;
      }
    }

    writeConfig(workDir, job.workers, job.headless, job.baseUrl, storageState);

    // Replay captured sessionStorage (MSAL/SPA tokens) only when a manual-auth
    // session actually exists; otherwise normalize spec imports back to
    // '@playwright/test' (mirrors `_apply_auth_fixtures`'s `use_fixtures` gate).
    const useFixtures = Boolean(job.manualAuth && storageState && sessionStoragePath && fs.statSync(sessionStoragePath).size > 0);
    applyAuthFixtures(
      workDir,
      job.specs.map((s) => s.filename),
      sessionStoragePath || path.join(workDir, "sessionStorage.json"),
      useFixtures
    );

    const total = job.specs.length;
    for (let i = 0; i < job.specs.length; i++) {
      const { ticket, caseCode } = identityFor(job.specs[i]);
      await api.postEvent(cfg, job.executionId, "exec.case.running", { ticket, caseCode, index: i + 1, total });
    }

    // A single-spec job targets just that one file (the "run this test"
    // action); a multi-case job executes the whole suite — same distinction
    // as the server's `single_spec`.
    const singleSpec = job.specs.length === 1 ? job.specs[0].filename : "";

    const started = Date.now();
    const { stdout, stderr, timedOut } = await runPlaywright(workDir, job.workers, singleSpec);
    const elapsedMs = Date.now() - started;
    const procOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
    let runError = "";
    if (timedOut) runError = `Playwright run timed out after ${EXEC_TIMEOUT_MS / 1000}s`;

    const reportPath = path.join(workDir, "report.json");
    let parsed: ParsedResult[] = [];
    if (!runError) {
      if (fs.existsSync(reportPath)) {
        try {
          parsed = parsePlaywrightReport(JSON.parse(fs.readFileSync(reportPath, "utf-8")));
        } catch (exc) {
          runError = `Could not parse Playwright report: ${(exc as Error).message}`;
        }
      } else {
        const detail = procOutput ? ` — ${procOutput.slice(0, 600)}` : "";
        runError = `Playwright produced no report.json${detail}`;
      }
    }

    let passed = 0;
    let failed = 0;
    const matched = new Set<string>();
    for (const spec of job.specs) {
      const entry = parsed.find((e) => path.basename(e.file) === spec.filename);
      if (!entry) continue;
      matched.add(spec.filename);
      const durationMs = entry.duration_ms || elapsedMs;
      await api.postResult(cfg, job.executionId, {
        file: spec.filename,
        status: entry.status,
        duration_ms: durationMs,
        error_message: entry.error_message,
      });
      if (entry.status === "pass") passed++;
      else if (entry.status === "fail") failed++;

      for (const att of entry.attachments) {
        const filePath = path.isAbsolute(att.path) ? att.path : path.join(workDir, att.path);
        if (!fs.existsSync(filePath)) continue;
        const { ticket, caseCode } = identityFor(spec);
        await api
          .postEvidence(cfg, job.executionId, {
            ticketExternalId: ticket,
            caseCode,
            kind: att.kind,
            filePath,
            filename: path.basename(filePath),
          })
          .catch((err) => console.error("postEvidence failed:", err));
      }

      const { ticket, caseCode } = identityFor(spec);
      await api.postEvent(cfg, job.executionId, "exec.case.result", {
        ticket,
        caseCode,
        status: entry.status,
        durationMs,
      });
      const progress = total ? Math.trunc((100 * matched.size) / total) : 100;
      await api.postEvent(cfg, job.executionId, "exec.progress", {
        progress,
        passed,
        failed,
        remaining: total - matched.size,
      });
    }

    // Any spec Playwright didn't report on (e.g. run_error) is marked failed.
    for (const spec of job.specs) {
      if (matched.has(spec.filename)) continue;
      failed++;
      const message = runError || "No result reported by Playwright";
      await api.postResult(cfg, job.executionId, {
        file: spec.filename,
        status: "fail",
        duration_ms: elapsedMs,
        error_message: message,
      });
      const { ticket, caseCode } = identityFor(spec);
      await api.postEvent(cfg, job.executionId, "exec.case.result", {
        ticket,
        caseCode,
        status: "fail",
        durationMs: elapsedMs,
      });
    }

    // Keep the LAST ~20000 chars so the failing tail survives truncation,
    // matching the server's own log persistence.
    const logText = (procOutput || runError || "").slice(-20000);
    await api.postComplete(cfg, job.executionId, { passed, failed, log: logText });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Long-poll loop: claim → process → repeat, backing off `IDLE_POLL_MS`
 * between empty claims. Runs until `signal.aborted`.
 */
export async function runAgentLoop(cfg: AgentConfig, signal: { aborted: boolean }): Promise<void> {
  if (!(await ensureChromium())) {
    console.error("Chromium is required to run tests — aborting.");
    return;
  }
  console.log(`Local Agent started — polling ${cfg.serverUrl} as device #${cfg.deviceId} (${cfg.deviceName})`);
  while (!signal.aborted) {
    let job: api.Job | null = null;
    try {
      job = await api.claimNextJob(cfg);
    } catch (err) {
      console.error("Claim failed:", (err as Error).message);
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
      continue;
    }
    console.log(`Claimed execution #${job.executionId} (run ${job.runCode}, ${job.specs.length} spec(s))`);
    try {
      await processJob(cfg, job);
      console.log(`Execution #${job.executionId} complete`);
    } catch (err) {
      console.error(`Execution #${job.executionId} crashed:`, err);
      await api
        .postComplete(cfg, job.executionId, {
          passed: 0,
          failed: job.specs.length,
          log: `Local Agent crashed: ${(err as Error).message}`,
        })
        .catch(() => {});
    }
  }
}
