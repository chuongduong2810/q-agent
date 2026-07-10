/**
 * Build a self-contained Windows bundle of the Local Agent.
 *
 * The agent shells out to the Playwright test runner and the vendored login-capture
 * script, and needs Chromium — so a single tiny .exe isn't possible. This produces a
 * folder (zip it for distribution) that runs with **no global Node**:
 *
 *   dist-bin/qagent-agent-win-x64/
 *     qagent-agent.exe   ← the CLI as a Node Single Executable Application (SEA)
 *     node.exe           ← Node runtime the CLI spawns for Playwright + capture
 *     node_modules/      ← production deps (playwright, @playwright/test, commander)
 *     vendor/            ← capture_auth.cjs
 *     README.md
 *
 * The .exe is built with Node's built-in SEA using the LOCAL node as the base
 * (no compiler, no download). Chromium is NOT bundled — the agent auto-installs
 * it on first run (see ensureBrowser.ts), keeping the download small.
 *
 * Usage:  npm run package:win   (run on Windows with a Node 20+ that supports SEA)
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(AGENT_DIR, "dist-bin", "qagent-agent-win-x64");
const WORK = path.join(AGENT_DIR, "dist-bin", ".sea-work");

function run(cmd, cwd = AGENT_DIR, env = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

/**
 * The SEA sentinel fuse compiled into a given node binary. It differs across
 * Node builds, so read it from the base binary rather than hardcoding — postject
 * must inject at exactly this string.
 */
function detectSeaFuse(nodeExe) {
  const m = fs.readFileSync(nodeExe).toString("latin1").match(/NODE_SEA_FUSE_[0-9a-f]+/);
  if (!m) throw new Error(`Could not find the SEA fuse sentinel in ${nodeExe}`);
  return m[0];
}

/**
 * Remove the Authenticode signature from a PE file so postject can find its SEA
 * sentinel (a signed node.exe copy otherwise fails injection). Zeroes the
 * Certificate Table data-directory entry and truncates the appended signature.
 */
function stripPeSignature(file) {
  const fd = fs.openSync(file, "r+");
  try {
    const u32 = (off) => {
      const b = Buffer.alloc(4);
      fs.readSync(fd, b, 0, 4, off);
      return b.readUInt32LE(0);
    };
    const peOff = u32(0x3c);
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, peOff + 24);
    const dataDirStart = peOff + 24 + (magic.readUInt16LE(0) === 0x20b ? 112 : 96);
    const certEntryOff = dataDirStart + 4 * 8; // data directory index 4 = Certificate Table
    const certOff = u32(certEntryOff);
    const certSize = u32(certEntryOff + 4);
    if (certSize > 0 && certOff > 0) {
      fs.writeSync(fd, Buffer.alloc(8), 0, 8, certEntryOff); // clear the entry
      fs.ftruncateSync(fd, certOff); // drop the appended signature overlay
      console.log(`  stripped Authenticode signature (${certSize} bytes)`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

console.log("== Local Agent · Windows bundle (SEA) ==");

// 1. Compile TypeScript → dist/.
run("npm run build");

// 2. Fresh dirs.
for (const d of [OUT, WORK]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

// 3. Bundle the CLI to a single CJS file. Playwright is left external — it's
//    invoked as a child process from the bundled node_modules, never in-process.
const bundle = path.join(WORK, "cli.cjs");
run(
  `npx esbuild dist/src/cli.js --bundle --platform=node --format=cjs ` +
    `--external:playwright --external:@playwright/test --outfile="${bundle}"`,
);

// 4. Generate the SEA blob.
const seaConfig = path.join(WORK, "sea-config.json");
fs.writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundle, output: path.join(WORK, "sea.blob"), disableExperimentalSEAWarning: true }),
);
run(`node --experimental-sea-config "${seaConfig}"`);

// 5. Copy the local node as the .exe base, then inject the blob.
const exe = path.join(OUT, "qagent-agent.exe");
fs.copyFileSync(process.execPath, exe);
stripPeSignature(exe);
const fuse = detectSeaFuse(process.execPath);
run(
  `npx postject "${exe}" NODE_SEA_BLOB "${path.join(WORK, "sea.blob")}" ` +
    `--sentinel-fuse ${fuse} --overwrite`,
);

// 6. Bundle a plain Node runtime the .exe spawns for the Playwright CLI + capture.
fs.copyFileSync(process.execPath, path.join(OUT, "node.exe"));

// 7. Production-only node_modules (no dev/build deps; skip the browser download —
//    the agent fetches Chromium itself on first run).
fs.copyFileSync(path.join(AGENT_DIR, "package.json"), path.join(OUT, "package.json"));
const lock = path.join(AGENT_DIR, "package-lock.json");
if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(OUT, "package-lock.json"));
run(`npm ci --omit=dev --no-audit --no-fund`, OUT, { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" });

// 8. Vendored capture script + README.
fs.cpSync(path.join(AGENT_DIR, "vendor"), path.join(OUT, "vendor"), { recursive: true });
fs.copyFileSync(path.join(AGENT_DIR, "README.md"), path.join(OUT, "README.md"));

// 9. Clean the work dir.
fs.rmSync(WORK, { recursive: true, force: true });

console.log(`\n✅ Bundle ready: ${OUT}`);
console.log("   Zip that folder for distribution. Users run: qagent-agent.exe pair <code> --server <url>");
