#!/usr/bin/env node
/**
 * One-command UI acceptance: start a throwaway rig, install the dynamic fixture,
 * run every live gate, and remove the rig even when a gate fails.
 *
 * The normal 3084 rig is the person's; this script never touches it. The rig uses
 * a temporary `XDG_DATA_HOME`, so its code-server extensions, profile and locks
 * live under `/tmp` and can be deleted wholesale.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const anchor = resolve(repo, "../../deepseek-harness/dsh-prac-dev");
const port = Number(process.env.PRAC_TEST_PORT ?? 3184);
const temp = await mkdtemp(join(tmpdir(), "prac-ui-"));
const dataHome = join(temp, "data");
const home = join(temp, "home");
const extensions = join(dataHome, "prac/code-server/extensions");
const fixture = join(repo, "tests/fixtures/dynamic-extension");

const gates = [
  ["containers", "tests/gates/verify-containers.mjs"],
  ["stack", "tests/gates/verify-stack.mjs"],
  ["split", "tests/gates/verify-split.mjs"],
  ["resize", "tests/gates/verify-resize.mjs"],
  ["persistence", "tests/gates/verify-persistence.mjs"],
  ["bottom", "tests/gates/verify-bottom.mjs"],
  ["views", "vendor/vscode/scripts/verify-views.mjs"],
  ["file", "vendor/vscode/scripts/verify-file.mjs"],
  ["tabs", "vendor/vscode/scripts/verify-tabs.mjs"],
  ["dynamic", "tests/gates/verify-dynamic.mjs"],
];

const run = (command, args, options = {}) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      options.onStdout?.(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      options.onStderr?.(String(chunk));
    });
    child.on("close", (code, signal) =>
      resolvePromise({ code: code ?? 1, signal, stdout, stderr }),
    );
  });

await mkdir(extensions, { recursive: true });
await mkdir(home, { recursive: true });
await cp(fixture, join(extensions, "prac.gate-dynamic-1.0.0"), { recursive: true });

let rig;
let url;
try {
  rig = spawn("pnpm", ["dsh", "--profile", "prac-dev", "--port", String(port), "--no-open"], {
    cwd: anchor,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      XDG_DATA_HOME: dataHome,
      pnpm_config_store_dir: process.env.pnpm_config_store_dir ?? "/Volumes/Dev/.pnpm-store",
    },
  });
  let rigOut = "";
  let rigErr = "";
  const captureUrl = (text) => {
    const match = /dsh web: (http\S+)/.exec(text);
    if (match && url === undefined) url = match[1];
  };
  rig.stdout.on("data", (chunk) => {
    rigOut += String(chunk);
    captureUrl(String(chunk));
  });
  rig.stderr.on("data", (chunk) => {
    rigErr += String(chunk);
    captureUrl(String(chunk));
  });
  rig.on("exit", (code) => {
    if (url === undefined) {
      process.stderr.write(`rig exited before publishing a URL (${code})\n`);
      process.stderr.write(`${rigOut.slice(-4000)}\n${rigErr.slice(-4000)}\n`);
    }
  });
  rig.on("error", (error) => {
    process.stderr.write(`rig failed to start: ${String(error)}\n`);
  });
  for (let attempt = 0; attempt < 120 && url === undefined; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (url === undefined) throw new Error("the throwaway rig did not publish a URL");

  let failed = false;
  for (const [name, script] of gates) {
    process.stdout.write(`\n=== ${name} ===\n`);
    const result = await run(process.execPath, [join(repo, script)], {
      cwd: repo,
      env: { ...process.env, URL: url },
    });
    const line = result.stdout
      .split("\n")
      .find((entry) => entry.startsWith("OK:") || entry.startsWith("SKIPPED:"));
    process.stdout.write(`${line ?? "no OK line"}\n`);
    if (result.code !== 0) {
      failed = true;
      process.stderr.write(result.stdout.slice(-4000));
      process.stderr.write(result.stderr.slice(-4000));
      break;
    }
  }
  if (failed) process.exitCode = 1;
  else process.stdout.write("\nUI ACCEPTANCE: all gates passed\n");
} finally {
  if (rig?.pid !== undefined) {
    try {
      process.kill(-rig.pid, "SIGINT");
    } catch {
      // already gone
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
    try {
      process.kill(-rig.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await rm(temp, { recursive: true, force: true });
}
