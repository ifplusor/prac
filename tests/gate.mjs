#!/usr/bin/env node
/**
 * Run one live gate against a page that is already running.
 *
 * `vp run verify:gate -- file` with `URL=<running prac page>`.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GATES } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const name = process.argv.slice(2).find((arg) => arg !== "--");
const entry = GATES.find(([gate]) => gate === name);

if (entry === undefined) {
  console.error(`verify: unknown gate "${name ?? ""}"`);
  console.error(`verify: gates: ${GATES.map(([gate]) => gate).join(", ")}`);
  process.exit(1);
}
if (process.env.URL === undefined) {
  console.error("verify: set URL=<a running prac page> to run one gate");
  process.exit(1);
}

const child = spawn(process.execPath, [join(repo, entry[1])], {
  cwd: repo,
  stdio: "inherit",
  env: process.env,
});
child.on("close", (code) => process.exit(code ?? 1));
