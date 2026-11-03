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
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GATES } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const anchor = resolve(repo, "../../deepseek-harness/dsh-prac-dev");
const port = Number(process.env.PRAC_TEST_PORT ?? 3184);
const temp = await mkdtemp(join(tmpdir(), "prac-ui-"));
const dataHome = join(temp, "data");
const home = join(temp, "home");
const dshHome = join(temp, "dsh");
const profileDir = join(dshHome, "profiles", "prac-dev");
const extensions = join(dataHome, "prac/code-server/extensions");
const target = join(extensions, "prac.gate-dynamic-1.0.0");
const fixture = join(repo, "tests/fixtures/dynamic-extension");
/**
 * Gate selection.
 *
 * The full set runs by default; `PRAC_GATES=file,split,stack` runs only the
 * named gates on the same rig, which is how a single assertion is iterated
 * without paying for the whole acceptance run. The lifecycle phases are part of
 * the full run only.
 */
// `vp run verify:ui -- file,stack` forwards the `--` as an argument too.
const positional = process.argv
  .slice(2)
  .filter((arg) => arg !== "--")
  .join(",")
  .trim();
if (positional !== "") process.env.PRAC_GATES = positional;

const selected = (process.env.PRAC_GATES ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");

const gates = GATES;
const knownGates = new Set(gates.map(([name]) => name));
const unknownGates = selected.filter((name) => !knownGates.has(name));
if (unknownGates.length > 0) {
  console.error(`verify-ui: unknown gate(s): ${unknownGates.join(", ")}`);
  console.error(`verify-ui: known gates: ${[...knownGates].join(", ")}`);
  process.exit(1);
}
const chosenGates =
  selected.length === 0 ? gates : gates.filter(([name]) => selected.includes(name));

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
  // The rig is the anchor's own CLI, launched with the anchor's pnpm shim by
  // absolute path: under `vp run` the PATH's pnpm resolves to a self-installed
  // SEA that bootstraps into the throwaway XDG tree and asserts.
  rig = spawn(
    join(anchor, "node_modules/.bin/pnpm"),
    ["dsh", "--profile", "prac-dev", "--port", String(port), "--no-open"],
    {
      cwd: anchor,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: home,
        DSH_HOME: dshHome,
        XDG_DATA_HOME: dataHome,
        pnpm_config_store_dir: process.env.pnpm_config_store_dir ?? "/Volumes/Dev/.pnpm-store",
      },
    },
  );
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
  if (process.env.PRAC_RIG_LOG === "1") {
    const { writeFileSync } = await import("node:fs");
    setInterval(
      () => writeFileSync("/tmp/prac-rig.log", `${stdout}\n--- stderr ---\n${stderr}`),
      1000,
    ).unref?.();
  }
  for (let attempt = 0; attempt < 120 && url === undefined; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  if (url === undefined) {
    process.stderr.write(
      `rig did not publish a URL in time\n${stdout.slice(-4000)}\n${stderr.slice(-4000)}\n`,
    );
    throw new Error("the throwaway rig did not publish a URL");
  }
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
  // Full output, not a tail: a gate's diagnostics (a probe, a console error, the
  // report JSON) are usually at the front, and a truncated tail is what made a
  // failing assertion undiagnosable in the editor migration.
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  return false;
}

await mkdir(extensions, { recursive: true });
await mkdir(home, { recursive: true });
await mkdir(profileDir, { recursive: true });
await writeFile(
  join(profileDir, "package.json"),
  JSON.stringify(
    {
      name: "dsh-profile-prac-dev",
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "prac-web-app"],
        },
      },
    },
    undefined,
    2,
  ) + "\n",
);
const linked = await run(process.execPath, [
  join(repo, "scripts/link-profile.mjs"),
  "--profile",
  "prac-dev",
  "--home",
  dshHome,
]);
if (linked.code !== 0) {
  process.stderr.write(linked.stdout + linked.stderr);
  throw new Error("could not link the local plugins into the throwaway profile");
}
await cp(fixture, target, { recursive: true });
fixtureInstalled = true;

try {
  let failed = false;
  await startRig();
  for (const [name, script] of chosenGates) {
    if (!(await runGate(name, script))) {
      failed = true;
      break;
    }
  }

  // The lifecycle phases need the full set (they restart the rig around the
  // dynamic fixture); a selected subset stops after its own gates.
  if (!failed && selected.length === 0) {
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
  else {
    const scope = selected.length === 0 ? "all gates" : `${chosenGates.length} selected gate(s)`;
    process.stdout.write(`\nUI ACCEPTANCE: ${scope} passed\n`);
  }
} finally {
  await stopRig();
  if (!fixtureInstalled)
    await cp(fixture, target, { recursive: true, force: true }).catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
