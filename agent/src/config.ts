/**
 * Local Agent config: server URL + paired device token, persisted at
 * `~/.qagent-agent/config.json`. This is the ONLY durable credential the
 * agent holds — a device token, never the user's app session.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface AgentConfig {
  /** Base URL of the Q-Agent server, e.g. "https://myteam.example.com". */
  serverUrl: string;
  /** Bearer token identifying this paired device. Shown once at pairing time. */
  deviceToken: string;
  /** Server-side AgentDevice id, for display in `status`. */
  deviceId: number;
  /** Human-readable device name (defaults to the machine hostname). */
  deviceName: string;
}

/** Directory holding the agent's persisted config + local session store. */
export function configDir(): string {
  return path.join(os.homedir(), ".qagent-agent");
}

function configPath(): string {
  return path.join(configDir(), "config.json");
}

/**
 * Load the persisted config, or `null` if the agent has never been paired
 * (or the file is missing/corrupt).
 */
export function loadConfig(): AgentConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    return JSON.parse(raw) as AgentConfig;
  } catch {
    return null;
  }
}

/**
 * Persist `cfg`, creating the config dir if needed. The file is written
 * with `0600` permissions (owner read/write only) since it holds a bearer
 * token; `chmod` is best-effort since it is a no-op on Windows.
 */
export function saveConfig(cfg: AgentConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  const p = configPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // Best-effort — chmod is a no-op on Windows filesystems.
  }
}

/** Remove the persisted config (the `logout` command). */
export function clearConfig(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // Already gone — logout is idempotent.
  }
}
