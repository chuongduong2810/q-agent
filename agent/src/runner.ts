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
import { emit } from "./bus";
import { AgentConfig } from "./config";
import { ensureChromium } from "./ensureBrowser";
import { agentNodeModules, childNodeEnv, nodeBin, playwrightCli, vendorCaptureScript } from "./paths";
import { applyFixtures, writeConfig } from "./playwrightConfig";
import { ParsedAttachment, ParsedResult, parsePlaywrightReport, parseSpecIdentity } from "./report";
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

function nodePathEnv(nm: string): NodeJS.ProcessEnv {
  const existing = process.env.NODE_PATH;
  return { ...process.env, ...childNodeEnv(), NODE_PATH: existing ? `${nm}${path.delimiter}${existing}` : nm };
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcResult> {
  return new Promise((resolve) => {
    // No shell: cmd is always an absolute node path (nodeBin()) and args are
    // absolute script/CLI paths, so this is safe even when paths contain spaces.
    const child = spawn(cmd, args, { cwd, env });
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
    nodeBin(),
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

async function runPlaywright(workDir: string, workers: number, specFile: string): Promise<ProcResult> {
  // Invoke Playwright's CLI through the resolved node runtime (`node cli.js test …`)
  // so the same path works from source, via npx, and in a packaged bundle where
  // `node`/`node_modules` live beside the executable rather than on PATH.
  const args = [playwrightCli(), "test", `--workers=${workers}`];
  if (specFile) args.push(specFile);
  const nm = agentNodeModules();
  return runProcess(nodeBin(), args, workDir, nodePathEnv(nm), EXEC_TIMEOUT_MS);
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

/** Resolved local auth for a job: paths to a saved session, or an `error` when a
 * required manual login could not be obtained (caller decides how to report it). */
interface ResolvedAuth {
  storageState: string;
  sessionStoragePath: string;
  error?: string;
}

/** Reuse a valid local session, or capture one headed — shared by the run + heal paths. */
async function resolveJobAuth(cfg: AgentConfig, job: api.Job): Promise<ResolvedAuth> {
  if (!job.manualAuth) return { storageState: "", sessionStoragePath: "" };
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
    return { storageState: paths.storageStatePath, sessionStoragePath: paths.sessionStoragePath };
  }
  if (origin && job.baseUrl) {
    const paths = sessionPathsForOrigin(origin);
    await api.postEvent(cfg, job.executionId, "exec.auth.waiting", { url: job.baseUrl });
    emit("auth-waiting", { url: job.baseUrl });
    const captured = await captureAuth(job.baseUrl, paths.storageStatePath, paths.sessionStoragePath);
    if (captured) {
      await api.postEvent(cfg, job.executionId, "exec.auth.captured", {});
      emit("auth-captured", {});
      return { storageState: paths.storageStatePath, sessionStoragePath: paths.sessionStoragePath };
    }
    const message = "Manual login was not completed — enable/redo login capture";
    await api.postEvent(cfg, job.executionId, "exec.auth.error", { message });
    emit("error", { message });
    return { storageState: "", sessionStoragePath: "", error: message };
  }
  const message = "Set a base URL for the project first.";
  await api.postEvent(cfg, job.executionId, "exec.auth.error", { message });
  emit("error", { message });
  return { storageState: "", sessionStoragePath: "", error: message };
}

/** Best-effort: read the distilled DOM JSON from a parsed attachment list. */
function loadDistilledDom(workDir: string, attachments: ParsedAttachment[]): unknown {
  const att = attachments.find((a) => a.kind === "dom-distilled");
  if (!att) return null;
  const p = path.isAbsolute(att.path) ? att.path : path.join(workDir, att.path);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Process one claimed job end-to-end: write specs/config, resolve auth, run Playwright, push results. */
export async function processJob(cfg: AgentConfig, job: api.Job): Promise<void> {
  if (job.heal) {
    await processHealJob(cfg, job, job.heal);
    return;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qagent-"));
  try {
    for (const spec of job.specs) {
      fs.writeFileSync(path.join(workDir, spec.filename), spec.code, "utf-8");
    }

    const auth = await resolveJobAuth(cfg, job);
    if (auth.error) {
      await failAllResults(cfg, job, auth.error);
      return;
    }
    const { storageState, sessionStoragePath } = auth;

    writeConfig(workDir, job.workers, job.headless, job.baseUrl, storageState);

    // Always inject the generated fixtures.ts (DOM capture on every run) + rewrite
    // spec imports to it. sessionStorage replay (MSAL/SPA tokens) is additionally
    // enabled only when a manual-auth session actually exists.
    const replaySession = Boolean(job.manualAuth && storageState && sessionStoragePath && fs.statSync(sessionStoragePath).size > 0);
    applyFixtures(
      workDir,
      job.specs.map((s) => s.filename),
      sessionStoragePath || path.join(workDir, "sessionStorage.json"),
      replaySession
    );

    const total = job.specs.length;
    for (let i = 0; i < job.specs.length; i++) {
      const { ticket, caseCode } = identityFor(job.specs[i]);
      await api.postEvent(cfg, job.executionId, "exec.case.running", { ticket, caseCode, index: i + 1, total });
      emit("case-running", { ticket, caseCode, index: i + 1, total });
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
      emit("case-result", { ticket, caseCode, status: entry.status, durationMs });
      const progress = total ? Math.trunc((100 * matched.size) / total) : 100;
      await api.postEvent(cfg, job.executionId, "exec.progress", {
        progress,
        passed,
        failed,
        remaining: total - matched.size,
      });
      emit("progress", { progress, passed, failed, remaining: total - matched.size });
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
    emit("job-complete", { executionId: job.executionId, passed, failed });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Process a standalone manual-login capture: open a headed browser at the
 * project's base URL ON THIS MACHINE, let the operator log in, and save the
 * session locally (keyed by origin) so subsequent runs reuse it. The session
 * never leaves this machine — only the pass/fail outcome is reported back.
 */
async function processCapture(cfg: AgentConfig, capture: api.CaptureJob): Promise<void> {
  let origin = capture.origin;
  if (!origin && capture.baseUrl) {
    try {
      origin = new URL(capture.baseUrl).origin;
    } catch {
      origin = "";
    }
  }
  if (!origin || !capture.baseUrl) {
    await api.postCaptureComplete(cfg, capture.captureId, false, "Missing base URL / origin").catch(() => {});
    return;
  }
  const paths = sessionPathsForOrigin(origin);
  // Force a fresh login: remove any prior session so captureAuth's
  // "storageState is non-empty" success check can't pass off a stale file
  // (which would falsely report success without opening a browser).
  try {
    fs.rmSync(paths.storageStatePath, { force: true });
    fs.rmSync(paths.sessionStoragePath, { force: true });
  } catch {
    // best-effort
  }
  emit("auth-waiting", { url: capture.baseUrl });
  console.log(`Capturing login for ${capture.projectKey} at ${capture.baseUrl}`);
  let ok = false;
  try {
    ok = await captureAuth(capture.baseUrl, paths.storageStatePath, paths.sessionStoragePath);
  } catch (err) {
    console.error("Capture crashed:", (err as Error).message);
  }
  if (ok) emit("auth-captured", {});
  else emit("error", { message: "Login was not captured — the window closed before a session was saved." });
  await api
    .postCaptureComplete(cfg, capture.captureId, ok, ok ? undefined : "Login was not captured")
    .catch((err) => console.error("postCaptureComplete failed:", err));
}

/**
 * Run the self-heal LOOP for one case locally (#260): run the spec + capture DOM,
 * and while it fails ask the server to classify + fix it (Claude + KB live
 * server-side), apply the returned code, and re-run — up to `maxAttempts`. Streams
 * `heal.progress`, uploads the final attempt's result + evidence, then posts the
 * outcome to `/agent/heal/{caseId}/finalize`.
 */
async function processHealJob(cfg: AgentConfig, job: api.Job, heal: { caseId: number; maxAttempts: number }): Promise<void> {
  const spec = job.specs[0];
  const { ticket, caseCode } = identityFor(spec);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qagent-heal-"));
  const progress = (phase: string, attempt: number, message: string, error = ""): Promise<void> =>
    api
      .postEvent(cfg, job.executionId, "heal.progress", {
        caseId: heal.caseId, ticket, caseCode, attempt, maxAttempts: heal.maxAttempts,
        phase, message, error: (error || "").slice(0, 600),
      })
      .catch(() => {});

  let currentCode = spec.code;
  let finalStatus: "pass" | "fail" | "blocked" | "product_defect" = "fail";
  let finalError = "";
  let elapsedMs = 0;
  let lastDom: unknown = null;
  let lastAttachments: ParsedAttachment[] = [];
  let lastFixBefore: string | null = null;
  let lastFixAfter: string | null = null;
  let blockReason = "";
  let gateReport = "";
  const attempts: Array<Record<string, unknown>> = [];

  try {
    const auth = await resolveJobAuth(cfg, job);
    if (auth.error) {
      finalError = auth.error;
    } else {
      const { storageState, sessionStoragePath } = auth;
      for (let attempt = 1; attempt <= heal.maxAttempts; attempt++) {
        fs.writeFileSync(path.join(workDir, spec.filename), currentCode, "utf-8");
        writeConfig(workDir, 1, job.headless, job.baseUrl, storageState);
        const replaySession = Boolean(
          job.manualAuth && storageState && sessionStoragePath && fs.statSync(sessionStoragePath).size > 0
        );
        applyFixtures(workDir, [spec.filename], sessionStoragePath || path.join(workDir, "sessionStorage.json"), replaySession);

        await progress("running", attempt, `Running spec (attempt ${attempt}/${heal.maxAttempts})`);
        const started = Date.now();
        const { stdout, stderr, timedOut } = await runPlaywright(workDir, 1, spec.filename);
        elapsedMs = Date.now() - started;
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();

        let entry: ParsedResult | undefined;
        const reportPath = path.join(workDir, "report.json");
        if (!timedOut && fs.existsSync(reportPath)) {
          try {
            const parsed = parsePlaywrightReport(JSON.parse(fs.readFileSync(reportPath, "utf-8")));
            entry = parsed.find((e) => path.basename(e.file) === spec.filename);
          } catch {
            // fall through to the no-report error below
          }
        }
        const rec: Record<string, unknown> = { attempt };
        if (entry) {
          lastAttachments = entry.attachments;
          lastDom = loadDistilledDom(workDir, entry.attachments);
        }

        if (entry && entry.status === "pass") {
          finalStatus = "pass";
          finalError = "";
          rec.status = "pass";
          attempts.push(rec);
          await progress("passed", attempt, "Spec passed");
          break;
        }

        finalStatus = "fail";
        finalError = entry
          ? entry.error_message || output || "Test failed"
          : timedOut
            ? "Playwright run timed out"
            : output || "No result reported by Playwright";
        rec.status = "fail";
        rec.error = finalError;

        if (attempt >= heal.maxAttempts) {
          attempts.push(rec);
          await progress("failed", attempt, "Still failing after max attempts", finalError);
          break;
        }

        await progress("fixing", attempt, "Asking the server to fix the spec", finalError);
        let fix: api.HealFixResult;
        try {
          fix = await api.postHealFix(cfg, heal.caseId, {
            currentCode, error: finalError, output, domDistilled: lastDom, attempt,
          });
        } catch (err) {
          finalError = `Heal fix request failed: ${(err as Error).message}`;
          rec.error = finalError;
          attempts.push(rec);
          await progress("failed", attempt, finalError, finalError);
          break;
        }

        rec.action = fix.action;
        if (fix.action === "product_defect") {
          finalStatus = "product_defect";
          rec.failureClass = fix.failureClass;
          rec.reason = fix.reason;
          attempts.push(rec);
          await progress("product_defect", attempt, "Product defect suspected — routing to report", finalError);
          break;
        }
        if (fix.action === "blocked") {
          finalStatus = "blocked";
          blockReason = fix.reason || "";
          gateReport = fix.gate || "";
          rec.gate = "blocked";
          rec.error = fix.reason;
          attempts.push(rec);
          await progress("failed", attempt, "Fix blocked by placeholder gate", fix.reason || "");
          break;
        }
        if (fix.action === "rejected") {
          finalStatus = "fail";
          rec.gate = "rejected";
          rec.error = fix.reason;
          attempts.push(rec);
          await progress("failed", attempt, "Fix rejected", fix.reason || "");
          break;
        }
        // action === "fixed": apply it and re-run.
        rec.fixed = true;
        rec.diff = fix.diff;
        attempts.push(rec);
        lastFixBefore = currentCode;
        lastFixAfter = fix.code || currentCode;
        currentCode = fix.code || currentCode;
      }
    }

    // Report the final attempt's result + evidence against the heal execution.
    const passResult = finalStatus === "pass";
    await api
      .postResult(cfg, job.executionId, {
        file: spec.filename, status: passResult ? "pass" : "fail",
        duration_ms: elapsedMs, error_message: passResult ? "" : finalError,
      })
      .catch((err) => console.error("postResult failed:", err));
    for (const att of lastAttachments) {
      const filePath = path.isAbsolute(att.path) ? att.path : path.join(workDir, att.path);
      if (!fs.existsSync(filePath)) continue;
      await api
        .postEvidence(cfg, job.executionId, {
          ticketExternalId: ticket, caseCode, kind: att.kind, filePath, filename: path.basename(filePath),
        })
        .catch((err) => console.error("postEvidence failed:", err));
    }
    await api
      .postEvent(cfg, job.executionId, "exec.case.result", {
        ticket, caseCode, status: passResult ? "pass" : "fail", durationMs: elapsedMs,
      })
      .catch(() => {});

    await api
      .postHealFinalize(cfg, heal.caseId, {
        finalStatus, finalError, finalCode: currentCode,
        blockReason, gateReport, domDistilled: lastDom,
        lastFixBefore, lastFixAfter, attempts,
      })
      .catch((err) => console.error("postHealFinalize failed:", err));

    await api
      .postComplete(cfg, job.executionId, { passed: passResult ? 1 : 0, failed: passResult ? 0 : 1, log: finalError })
      .catch((err) => console.error("postComplete failed:", err));
    emit("job-complete", { executionId: job.executionId, passed: passResult ? 1 : 0, failed: passResult ? 0 : 1 });
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
      // No execution queued — check for a standalone login-capture request.
      let capture: api.CaptureJob | null = null;
      try {
        capture = await api.claimNextCapture(cfg);
      } catch (err) {
        console.error("Capture claim failed:", (err as Error).message);
      }
      if (capture) {
        await processCapture(cfg, capture);
        continue;
      }
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
      continue;
    }
    console.log(`Claimed execution #${job.executionId} (run ${job.runCode}, ${job.specs.length} spec(s))`);
    emit("job-claimed", { executionId: job.executionId, runCode: job.runCode, total: job.specs.length });
    try {
      await processJob(cfg, job);
      console.log(`Execution #${job.executionId} complete`);
    } catch (err) {
      console.error(`Execution #${job.executionId} crashed:`, err);
      emit("error", { message: `Execution #${job.executionId} crashed: ${(err as Error).message}` });
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
