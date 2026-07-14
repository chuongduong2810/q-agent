/**
 * The running agent's version.
 *
 * Read from the package manifest at runtime (rather than a compile-time import)
 * so both the `npx @q-agent/agent` package and the packaged desktop bundle report
 * the *actual* installed build — the number one signal when diagnosing a stale
 * `npx` cache serving an old agent. Compiled output lives at `dist/src/`, so the
 * manifest is two levels up. Any failure falls back to `"unknown"` — a missing
 * version must never crash the CLI.
 */

import * as path from "path";

let cached: string | null = null;

/** The agent's semver (e.g. "0.1.6"), or "unknown" if the manifest can't be read. */
export function agentVersion(): string {
  if (cached !== null) return cached;
  try {
    const manifest = require(path.join(__dirname, "..", "..", "package.json")) as { version?: string };
    cached = manifest.version || "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}
