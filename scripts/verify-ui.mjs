#!/usr/bin/env node
/**
 * One-command UI acceptance: run every live gate on a throwaway rig, then prove
 * the extension lifecycle by restarting that rig without the dynamic fixture and
 * with it restored. The normal 3084 rig is never touched.
 *
 * Requires permission to write the DSH profile outside the workspace (the CLI
 * resolves it from the user home, not from the temporary XDG tree).
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
const target = join(extensions, "prac.gate-dynamic-1.0.0");
const fixture = join(repo, "tests/fixtures/dynamic-extension");
const gates = [
  ["containers", "tests/gates/verify-containers.mjs"],
  ["stack", "tests/gates/verify-stack.mjs"],
  ["split", "tests/gates/verify-split.mjs"],
  ["grid", "tests/gates/verify-grid.mjs"],
  ["grid:resize", "tests/gates/verify-grid-resize.mjs"],
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
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code, signal) =>
      resolvePromise({ code: code ?? 1, signal, stdout, stderr }),
    );
  });

let rig;
let url;
let fixtureInstalled = false;

async function startRig() {
  url = undefined;
  rig = spawn("pnpm", ["dsh", "--profile", "prac-dev", "--port", String(port), "--no-open"], {
    cwd: anchor,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: dataHome,
      pnpm_config_store_dir: process.env.pnpm_config_store_dir ?? "/Volumes/Dev/.pnpm-store",
    },
  });
  let stdout = "";
  let stderr = "";
  const capture = (text) => {
    const match = /dsh web: (http\S+)/.exec(text);
    if (match && url === undefined) url = match[1];
  };
  rig.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    capture(String(chunk));
  });
  rig.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    capture(String(chunk));
  });
  rig.on("exit", (code) => {
    if (url === undefined) {
      process.stderr.write(`rig exited before publishing a URL (${code})\n`);
      process.stderr.write(`${stdout.slice(-4000)}\n${stderr.slice(-4000)}\n`);
    }
  });
  for (let attempt = 0; attempt < 120 && url === undefined; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (url === undefined) throw new Error("the throwaway rig did not publish a URL");
}

async function stopRig() {
  if (rig?.pid === undefined) return;
  try {
    process.kill(-rig.pid, "SIGINT");
  } catch {
    // already gone
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
  try {
    process.kill(-rig.pid, "SIGKILL");
  } catch {
    // already gone
  }
  rig = undefined;
  url = undefined;
}

async function runGate(name, script, extra = {}) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const result = await run(process.execPath, [join(repo, script)], {
    cwd: repo,
    env: { ...process.env, URL: url, EXTENSIONS_DIR: extensions, ...extra },
  });
  const line = result.stdout
    .split("\n")
    .find((entry) => entry.startsWith("OK:") || entry.startsWith("SKIPPED:"));
  process.stdout.write(`${line ?? "no OK line"}\n`);
  if (result.code === 0) return true;
  process.stderr.write(result.stdout.slice(-4000));
  process.stderr.write(result.stderr.slice(-4000));
  return false;
}

await mkdir(extensions, { recursive: true });
await mkdir(home, { recursive: true });
await cp(fixture, target, { recursive: true });
fixtureInstalled = true;

try {
  let failed = false;
  await startRig();
  for (const [name, script] of gates) {
    if (!(await runGate(name, script))) {
      failed = true;
      break;
    }
  }

  if (!failed) {
    await stopRig();
    await rm(target, { recursive: true, force: true });
    fixtureInstalled = false;
    await startRig();
    failed = !(await runGate("lifecycle:absent", "tests/gates/verify-extension-lifecycle.mjs", {
      PHASE: "absent",
    }));

    await stopRig();
    await cp(fixture, target, { recursive: true, force: true });
    fixtureInstalled = true;
    await startRig();
    failed =
      failed ||
      !(await runGate("lifecycle:restored", "tests/gates/verify-extension-lifecycle.mjs", {
        PHASE: "restored",
      }));
    await stopRig();
  }

  if (failed) process.exitCode = 1;
  else process.stdout.write("\nUI ACCEPTANCE: all gates passed\n");
} finally {
  await stopRig();
  if (!fixtureInstalled)
    await cp(fixture, target, { recursive: true, force: true }).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
