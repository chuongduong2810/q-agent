/**
 * Local session store: captured `storageState.json` + `sessionStorage.json`
 * per project origin, kept under the agent's config dir. These files hold
 * the user's actual cookies/localStorage/sessionStorage and are NEVER
 * uploaded to the server — only referenced by the local
 * `playwright.config.ts` (storageState) and the generated `fixtures.ts`
 * (sessionStorage replay), mirroring `project_config_service.auth_path` /
 * `.session_path` on the server, but scoped to this machine instead of a
 * server-side owner.
 */

import * as fs from "fs";
import * as path from "path";
import { configDir } from "./config";

export interface SessionPaths {
  dir: string;
  storageStatePath: string;
  sessionStoragePath: string;
}

/** Turn an origin like "https://app.example.com" into a filesystem-safe dir name. */
function sanitizeOrigin(origin: string): string {
  return origin.replace(/[^a-zA-Z0-9.-]/g, "_");
}

/** Resolve the on-disk paths for a given origin's captured session. */
export function sessionPathsForOrigin(origin: string): SessionPaths {
  const dir = path.join(configDir(), "sessions", sanitizeOrigin(origin));
  return {
    dir,
    storageStatePath: path.join(dir, "storageState.json"),
    sessionStoragePath: path.join(dir, "sessionStorage.json"),
  };
}

/** True if a non-empty captured `storageState.json` exists for `origin`. */
export function hasValidSession(origin: string): boolean {
  const { storageStatePath } = sessionPathsForOrigin(origin);
  try {
    return fs.statSync(storageStatePath).size > 0;
  } catch {
    return false;
  }
}

/** True if a non-empty captured `sessionStorage.json` exists for `origin`. */
export function hasSessionStorage(origin: string): boolean {
  const { sessionStoragePath } = sessionPathsForOrigin(origin);
  try {
    return fs.statSync(sessionStoragePath).size > 0;
  } catch {
    return false;
  }
}
