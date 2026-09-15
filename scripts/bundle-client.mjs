#!/usr/bin/env node
/**
 * Assert that a package's client artifact is loadable by DSH.
 *
 * The wrapper (*what shape* the artifact must have) is declared in
 * `scripts/pack-client.ts` and applied by `vp pack`. What cannot be declared is
 * the **proof that it came out that way**: a bundler that inlines a module the
 * loader's table already answers, or drops the closure, still exits 0 and still
 * writes `client.js` — and the page dies at boot with a blank screen. So this is
 * the post-build assertion, run as an explicit task rather than hidden inside a
 * build script.
 *
 * It checks, on the emitted bytes:
 *
 * 1. **the closure is intact** — the artifact opens the `__ModuleLoader__.load`
 *    handoff for the expected id, and closes the factory it opened;
 * 2. **every `require` is answerable** — the loader's module table answers a
 *    fixed set of specifiers; a `require` it cannot answer is a guaranteed
 *    runtime throw, so anything outside the allowlist fails the build;
 * 3. **framework copies were not inlined** — a second React in the bundle is a
 *    blank page, not a size regression.
 *
 * Usage:
 *
 * ```bash
 * node scripts/bundle-client.mjs \
 *   --artifact packages/prac-web-app/dist/client.js \
 *   --id prac-web-app --allow react \
 *   --exports apply,name,inject
 * ```
 *
 * `--exports` is optional: it asserts the names the loader expects to find on
 * the plugin's exports (a renamed export is otherwise only visible at boot).
 *
 * @module scripts/bundle-client
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** A required single-value option, read from `argv`. */
function required(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`bundle-client: --${name} is required`);
    process.exit(2);
  }
  return value;
}

/** Every value of a repeatable, comma-splittable option. */
function repeated(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== `--${name}`) continue;
    const value = process.argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`bundle-client: --${name} needs a value`);
      process.exit(2);
    }
    // Both `--allow a --allow b` and `--allow a,b` are accepted; an unsplit
    // comma would otherwise become one name no specifier can ever equal.
    values.push(...value.split(",").filter((part) => part.length > 0));
  }
  return values;
}

const artifact = resolve(required("artifact"));
const id = required("id");
const allowed = new Set(repeated("allow"));
const expectedExports = repeated("exports");

/** Report one failed assertion and mark the run failed. */
const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
}

let source;
try {
  source = readFileSync(artifact, "utf8");
} catch (error) {
  console.error(`bundle-client: cannot read ${artifact} (${error.message})`);
  process.exit(1);
}

// ── 1. the loader closure ────────────────────────────────────────────────────
const opening = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`;
check(source.startsWith(opening), `does not open the loader handoff for id "${id}"`);
check(
  source.trimEnd().endsWith("return module.exports; } });"),
  "does not close the loader factory it opened",
);

// The CJS envelope the factory evaluates the bundle inside. Asserting it is what
// makes this check worth running: the toolchain accepts an `intro` field and then
// silently drops it, so without this the artifact's `exports.x = …` lines all
// look fine and the page still dies with `exports is not defined`.
check(
  source.includes("var module = { exports: {} }; var exports = module.exports;"),
  "does not declare the CJS envelope inside the factory " +
    "(without it the bundle throws `exports is not defined` when the loader runs it)",
);

// ── 2. every bare require is answerable by the module table ──────────────────
const bareRequires = [...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)]
  .map((match) => match[1])
  .filter((specifier) => !specifier.startsWith("."));
const unanswerable = [...new Set(bareRequires)].filter((specifier) => !allowed.has(specifier));
check(
  unanswerable.length === 0,
  `requires module(s) the loader cannot answer: ${unanswerable.join(", ")} — ` +
    `only ${[...allowed].join(", ") || "(none)"} may stay external; inline everything else`,
);

// ── 3. no framework copy was inlined ─────────────────────────────────────────
check(
  !/Symbol\.for\(\s*["']react\./.test(source) && !source.includes("react.development"),
  "React was inlined into the bundle; it must stay external",
);

// ── 4. the exports the loader reads are present ──────────────────────────────
for (const name of expectedExports) {
  check(new RegExp(`\\bexports\\.${name}\\b`).test(source), `does not export "${name}"`);
}

if (failures.length > 0) {
  console.error(`bundle-client: ${artifact} is not a loadable client artifact:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `bundle-client: ${artifact} ok — loader(${id}), externals [${[...allowed].join(", ")}]` +
    (expectedExports.length > 0 ? `, exports [${expectedExports.join(", ")}]` : ""),
);
