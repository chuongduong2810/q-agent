/**
 * Typed HTTP client for the Local Agent wire protocol served by
 * `api/app/routers/agent.py`. Every job call sends
 * `Authorization: Bearer <deviceToken>`. Uses Node's built-in `fetch`
 * (Node 18+) — no extra HTTP dependency.
 */

import * as fs from "fs";
import { AgentConfig } from "./config";

/** Raised for any non-2xx/204 response; carries the HTTP status for callers that care (e.g. 409). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Request failed with status ${status}: ${body.slice(0, 500)}`);
  }
}

/** One spec source pulled from `AutomationSpec.code` for a claimed job.
 *
 * `ticketExternalId`/`caseCode` are OPTIONAL: the current server foundation
 * (`routers/agent.py` `claim_next_job`) does not include them, only
 * `filename`/`code` (see agent/README.md "Known limitation"). They are
 * typed here so the agent picks them up for free if a future server patch
 * adds them, without another wire-format change.
 */
export interface JobSpec {
  filename: string;
  code: string;
  ticketExternalId?: string;
  caseCode?: string;
}

/** The `/agent/jobs/next` claim payload. */
export interface Job {
  executionId: number;
  runCode: string;
  env: string;
  browser: string;
  workers: number;
  headless: boolean;
  baseUrl: string;
  manualAuth: boolean;
  authOrigins: string[];
  specs: JobSpec[];
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => ""));
  }
}

/** Redeem a one-time pairing code for a durable device token (the `pair` command). */
export async function redeemDevice(
  serverUrl: string,
  code: string,
  name: string
): Promise<{ deviceToken: string; deviceId: number }> {
  const res = await fetch(`${serverUrl}/agent/devices/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  await throwIfNotOk(res);
  return (await res.json()) as { deviceToken: string; deviceId: number };
}

/** Self-revoke this device on the server (the "Disconnect" action). Best-effort:
 * the caller wipes the local token regardless, so a failure here only means the
 * server list clears on `last_seen_at` staleness instead of immediately. */
export async function disconnectDevice(cfg: AgentConfig): Promise<void> {
  const res = await fetch(`${cfg.serverUrl}/agent/disconnect`, {
    method: "POST",
    headers: authHeaders(cfg.deviceToken),
  });
  await throwIfNotOk(res);
}

/** Long-poll claim the next queued job for this device's owner. `null` on 204 (nothing queued). */
export async function claimNextJob(cfg: AgentConfig): Promise<Job | null> {
  const res = await fetch(`${cfg.serverUrl}/agent/jobs/next`, {
    method: "POST",
    headers: authHeaders(cfg.deviceToken),
  });
  if (res.status === 204) return null;
  await throwIfNotOk(res);
  return (await res.json()) as Job;
}

/** Push one progress event; the server re-emits it on the run's WebSocket unchanged. */
export async function postEvent(
  cfg: AgentConfig,
  executionId: number,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${cfg.serverUrl}/agent/jobs/${executionId}/events`, {
    method: "POST",
    headers: { ...authHeaders(cfg.deviceToken), "Content-Type": "application/json" },
    body: JSON.stringify({ event, payload }),
  });
  await throwIfNotOk(res);
}

/** One parsed result entry, shaped like `parse_playwright_report`'s per-spec output. */
export interface ResultEntry {
  file: string;
  status: string;
  duration_ms: number;
  error_message: string;
}

/** Push one parsed case result; the server matches it to its `ExecutionResult` by filename. */
export async function postResult(cfg: AgentConfig, executionId: number, entry: ResultEntry): Promise<void> {
  const res = await fetch(`${cfg.serverUrl}/agent/jobs/${executionId}/results`, {
    method: "POST",
    headers: { ...authHeaders(cfg.deviceToken), "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  await throwIfNotOk(res);
}

/** One evidence artifact to upload for a case's result. */
export interface EvidenceUpload {
  ticketExternalId: string;
  caseCode: string;
  kind: string;
  filePath: string;
  filename: string;
}

/** Multipart-upload one evidence artifact (screenshot/video/trace). */
export async function postEvidence(cfg: AgentConfig, executionId: number, ev: EvidenceUpload): Promise<void> {
  const data = fs.readFileSync(ev.filePath);
  const form = new FormData();
  form.set("ticket_external_id", ev.ticketExternalId);
  form.set("case_code", ev.caseCode);
  form.set("kind", ev.kind);
  form.set("file", new Blob([data]), ev.filename);
  const res = await fetch(`${cfg.serverUrl}/agent/jobs/${executionId}/evidence`, {
    method: "POST",
    headers: authHeaders(cfg.deviceToken),
    body: form,
  });
  await throwIfNotOk(res);
}

/** Finalize an execution with its aggregate counts + captured log tail. */
export async function postComplete(
  cfg: AgentConfig,
  executionId: number,
  body: { passed: number; failed: number; log: string }
): Promise<void> {
  const res = await fetch(`${cfg.serverUrl}/agent/jobs/${executionId}/complete`, {
    method: "POST",
    headers: { ...authHeaders(cfg.deviceToken), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
}
