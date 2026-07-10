#!/usr/bin/env node
/**
 * One-shot release for @q-agent/agent: bump the patch version, rebuild, and
 * publish to npm — for when there are new changes to ship.
 *
 * Usage (from the agent/ dir):
 *   npm run release              # npm prompts for the 2FA OTP interactively
 *   npm run release -- --otp=123456   # non-interactive (CI, or a piped shell)
 *   npm run release -- --minor        # bump minor instead of patch (also --major)
 *
 * The version bump uses --no-git-tag-version, so it edits package.json only and
 * never requires a clean git tree or creates a tag. `npm publish` runs the
 * package's prepublishOnly hook (a fresh `tsc` build) before uploading.
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const otpArg = args.find((a) => a.startsWith("--otp="));
const level = args.includes("--major") ? "major" : args.includes("--minor") ? "minor" : "patch";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

// 1. Bump the version (package.json only — no git tag, no clean-tree requirement).
run(`npm version ${level} --no-git-tag-version`);

// 2. Publish (prepublishOnly rebuilds first). npm prompts for the OTP if --otp
//    was not supplied; passing it through keeps the flow non-interactive.
run(`npm publish${otpArg ? ` ${otpArg}` : ""}`);
