/**
 * Ensure Playwright's Chromium build is present, downloading it once if absent —
 * so the user never has to run `npx playwright install chromium` manually.
 *
 * Both the headed login capture (`vendor/capture_auth.cjs`) and the spec run use
 * Chromium from the agent's own Playwright install; this guarantees it exists
 * before either runs.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** The agent package's own node_modules (mirrors runner.ts's resolver). */
function agentNodeModules(): string {
  return (
    firstExisting([path.join(__dirname, "..", "..", "node_modules"), path.join(__dirname, "..", "node_modules")]) ??
    path.join(__dirname, "..", "..", "node_modules")
  );
}

/** Path Playwright expects the Chromium build at, or null if it can't be resolved. */
function chromiumExecutable(): string | null {
  try {
    // Resolved from the agent's own node_modules — the same install used to run specs.
    const { chromium } = require("playwright") as typeof import("playwright");
    return chromium.executablePath();
  } catch {
    return null;
  }
}

/**
 * Ensure Chromium is installed, running `playwright install chromium` if it's missing.
 *
 * Fast no-op once the browser exists. Streams the download progress so a first-run
 * fetch (~100 MB) is visible rather than a silent hang.
 *
 * Returns:
 *   true when Chromium is available (already present, or installed successfully);
 *   false when the install failed — the caller should abort rather than run.
 */
export async function ensureChromium(): Promise<boolean> {
  const exe = chromiumExecutable();
  if (exe && fs.existsSync(exe)) return true;

  console.log("Chromium not found — installing Playwright's Chromium (one-time download)...");
  const nm = agentNodeModules();
  const bin = path.join(nm, ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");
  const useBin = fs.existsSync(bin);
  const cmd = useBin ? bin : "npx";
  const args = useBin ? ["install", "chromium"] : ["playwright", "install", "chromium"];

  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("close", resolve);
    child.on("error", () => resolve(null));
  });

  if (code !== 0) {
    console.error("Chromium install failed — run `npx playwright install chromium` manually, then retry.");
    return false;
  }
  console.log("Chromium ready.");
  return true;
}
