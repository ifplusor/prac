#!/usr/bin/env node
/**
 * The verification CLI: one entry for every test asset.
 *
 * The root manifest keeps one command (`pnpm verify`) instead of a `verify:*`
 * alias per gate, so the roster lives with the assets (`tests/gates.mjs`) rather
 * than in the package manifest.
 *
 * @example
 * pnpm verify                 // everything: static gates + live acceptance
 * pnpm verify ui              // live acceptance only
 * pnpm verify ui file,stack   // a subset of the live gates
 * pnpm verify static          // entries + packages + pinned DSH types
 * pnpm verify gate file       // one live gate against URL=<running page>
 * pnpm verify list            // the gate names
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GATES } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

/**
 * Run one command with the repo as cwd and inherited stdio.
 *
 * @param {string} script - the script path.
 * @param {readonly string[]} [args] - its arguments.
 * @returns {Promise<number>} the exit code.
 */
const run = (script, args = []) =>
  new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repo,
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });

/** The static gates, in the order they should fail fast. */
const STATIC = [
  [join(here, "static/entries.ts"), []],
  [join(here, "static/packages.ts"), []],
  [join(repo, "scripts/dsh-types.mjs"), ["--compare"]],
];

const usage = `usage: pnpm verify <command>

  (none)            static gates, then the full live acceptance
  ui [gates]        live acceptance; an optional comma list restricts it
  static            entries + packages + pinned DSH types
  gate <name>       one live gate against URL=<a running prac page>
  list              the live gate names

live gates: ${GATES.map(([name]) => name).join(", ")}
`;

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined: {
    for (const [script, extra] of STATIC) {
      const code = await run(script, extra);
      if (code !== 0) process.exit(code);
    }
    process.exit(await run(join(here, "ui.mjs")));
  }
  case "ui": {
    const selected = args.join(",").trim();
    if (selected !== "") process.env.PRAC_GATES = selected;
    process.exit(await run(join(here, "ui.mjs")));
  }
  case "static": {
    for (const [script, extra] of STATIC) {
      const code = await run(script, extra);
      if (code !== 0) process.exit(code);
    }
    process.exit(0);
  }
  case "gate": {
    const name = args[0];
    const entry = GATES.find(([gate]) => gate === name);
    if (entry === undefined) {
      console.error(`verify: unknown gate "${name ?? ""}"`);
      console.error(usage);
      process.exit(1);
    }
    if (process.env.URL === undefined) {
      console.error("verify: set URL=<a running prac page> to run one gate");
      process.exit(1);
    }
    process.exit(await run(join(repo, entry[1])));
  }
  case "list": {
    for (const [name, script] of GATES) console.log(`${name}\t${script}`);
    process.exit(0);
  }
  default: {
    console.error(`verify: unknown command "${command}"`);
    console.error(usage);
    process.exit(1);
  }
}
