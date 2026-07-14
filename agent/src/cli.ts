#!/usr/bin/env node
/**
 * `qagent-agent` CLI — `npx @q-agent/agent <command>`.
 *
 * Commands:
 *   pair <code> [--server <url>] [--name <name>]  Redeem a one-time pairing code for a device token.
 *   start [--server <url>]                        Long-poll for jobs and run them.
 *   status                                        Show pairing state.
 *   logout                                        Forget the device token.
 */

import { Command } from "commander";
import * as os from "os";
import { AgentConfig, clearConfig, defaultServerUrl, loadConfig, saveConfig } from "./config";
import { redeemDevice } from "./api";
import { killActiveChild, runAgentLoop } from "./runner";
import { startUi } from "./ui";
import { agentVersion } from "./version";

/** How the user invoked this agent, for accurate "run X" hints: the bare command
 * inside a packaged bundle, else the `npx` form of the published package. */
function invocation(): string {
  return (process as { pkg?: unknown }).pkg ? "qagent-agent" : "npx @q-agent/agent";
}

const program = new Command();
program
  .name("qagent-agent")
  .description("Q-Agent Local Agent — runs Playwright locally for this machine's owner.")
  // Surfaces the actual installed build (e.g. via `npx @q-agent/agent --version`),
  // so a stale npx cache serving an old agent is easy to spot.
  .version(agentVersion(), "-v, --version", "print the agent version");

program
  .command("pair")
  .description("Redeem a one-time pairing code (from the Q-Agent SPA) for a device token")
  .argument("<code>", "pairing code shown in the SPA")
  .option("--server <url>", "Q-Agent server base URL (defaults to the server baked into this build)")
  .option("--name <name>", "device name shown in the paired-devices list", os.hostname())
  .action(async (code: string, opts: { server?: string; name: string }) => {
    const serverUrl = (opts.server || defaultServerUrl() || "http://127.0.0.1:8787").replace(/\/+$/, "");
    try {
      const { deviceToken, deviceId } = await redeemDevice(serverUrl, code, opts.name);
      const cfg: AgentConfig = { serverUrl, deviceToken, deviceId, deviceName: opts.name };
      saveConfig(cfg);
      console.log(`Paired as device #${deviceId} (${opts.name}) against ${serverUrl}`);
      console.log(`Device token stored — run \`${invocation()} start\` to begin claiming jobs.`);
    } catch (err) {
      console.error("Pairing failed:", (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("start")
  .description("Long-poll for queued jobs and run them")
  .option("--server <url>", "override the paired server base URL for this run")
  .action(async (opts: { server?: string }) => {
    const cfg = loadConfig();
    if (!cfg) {
      console.error(`Not paired yet — run \`${invocation()} pair <code>\` first.`);
      process.exitCode = 1;
      return;
    }
    if (opts.server) cfg.serverUrl = opts.server.replace(/\/+$/, "");

    const signal = { aborted: false };
    const shutdown = () => {
      console.log("\nShutting down — killing any active Playwright/capture process...");
      signal.aborted = true;
      killActiveChild();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await runAgentLoop(cfg, signal);
  });

program
  .command("status")
  .description("Show whether this machine is paired")
  .action(() => {
    const cfg = loadConfig();
    if (!cfg) {
      console.log(`Not paired. Run \`${invocation()} pair <code>\` to pair this machine.`);
      return;
    }
    console.log(`Paired as device #${cfg.deviceId} (${cfg.deviceName})`);
    console.log(`Server: ${cfg.serverUrl}`);
  });

program
  .command("logout")
  .description("Forget the paired device token")
  .action(() => {
    clearConfig();
    console.log(`Device token cleared. Run \`${invocation()} pair <code>\` to pair again.`);
  });

program
  .command("ui", { isDefault: true })
  .description("Open the local web UI to pair and watch progress in your browser (default)")
  .option("--port <port>", "port for the local UI server (default 7420)")
  .option("--no-open", "start the UI server without opening a browser")
  .action((opts: { port?: string; open?: boolean }) => {
    startUi({ port: opts.port ? Number(opts.port) : undefined, open: opts.open !== false });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
