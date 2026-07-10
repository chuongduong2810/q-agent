#!/usr/bin/env node
/**
 * `qagent-agent` CLI — `npx @qagent/agent <command>`.
 *
 * Commands:
 *   pair <code> [--server <url>] [--name <name>]  Redeem a one-time pairing code for a device token.
 *   start [--server <url>]                        Long-poll for jobs and run them.
 *   status                                        Show pairing state.
 *   logout                                        Forget the device token.
 */

import { Command } from "commander";
import * as os from "os";
import { AgentConfig, clearConfig, loadConfig, saveConfig } from "./config";
import { redeemDevice } from "./api";
import { killActiveChild, runAgentLoop } from "./runner";

const program = new Command();
program.name("qagent-agent").description("Q-Agent Local Agent — runs Playwright locally for this machine's owner.");

program
  .command("pair")
  .description("Redeem a one-time pairing code (from the Q-Agent SPA) for a device token")
  .argument("<code>", "pairing code shown in the SPA")
  .option("--server <url>", "Q-Agent server base URL", "http://127.0.0.1:8787")
  .option("--name <name>", "device name shown in the paired-devices list", os.hostname())
  .action(async (code: string, opts: { server: string; name: string }) => {
    const serverUrl = opts.server.replace(/\/+$/, "");
    try {
      const { deviceToken, deviceId } = await redeemDevice(serverUrl, code, opts.name);
      const cfg: AgentConfig = { serverUrl, deviceToken, deviceId, deviceName: opts.name };
      saveConfig(cfg);
      console.log(`Paired as device #${deviceId} (${opts.name}) against ${serverUrl}`);
      console.log("Device token stored — run `qagent-agent start` to begin claiming jobs.");
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
      console.error("Not paired yet — run `qagent-agent pair <code>` first.");
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
      console.log("Not paired. Run `qagent-agent pair <code>` to pair this machine.");
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
    console.log("Device token cleared. Run `qagent-agent pair <code>` to pair again.");
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
