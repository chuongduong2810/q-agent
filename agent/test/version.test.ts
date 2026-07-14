/**
 * Tests for the runtime version lookup (`src/version.ts`) — the agent must be
 * able to report its actual installed build (for `--version` and the startup
 * banner), which is the key signal when diagnosing a stale npx cache.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { agentVersion } from "../src/version";

test("agentVersion reads a real semver from the package manifest (not 'unknown')", () => {
  const v = agentVersion();
  assert.notEqual(v, "unknown", "expected the manifest version to resolve at runtime");
  assert.match(v, /^\d+\.\d+\.\d+/, `expected semver, got ${v}`);
});

test("agentVersion is stable across calls (cached)", () => {
  assert.equal(agentVersion(), agentVersion());
});
