#!/usr/bin/env node
/**
 * Static gate for the shape of prac's client plugin packages.
 *
 * A client package is a DSH plugin row, not a library: it has exactly one
 * loader entry (`src/client/index.ts`), no second importable artifact, and it
 * reaches other plugins through Cordis services rather than value imports. The
 * rules are stated in `docs/client-packages.md`; this file is the mechanical
 * half of that document.
 *
 * Checked per package:
 *
 * 1. `src/client/index.ts` exists and `vite.config.ts` names it as the
 *    `clientPack()` entry, with the bundle id equal to the package name.
 * 2. No `src/client/plugin.ts` / `src/client/lib.ts`, and no `./lib` export.
 * 3. `dsh.client.platform` is `web`; `./client` exists and points at
 *    `dist/client.js`.
 * 4. A declared `./client.types` comes from `src/client/contract.ts` and lands
 *    at `dist/client-types.d.mts`.
 * 5. A `check:client` task exists (the artifact-shape assertion).
 * 6. Source has no **value** import or re-export of another `prac-client-*`
 *    package: cross-plugin sharing is a Cordis service, and types travel
 *    through `import type`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const clientDir = join(root, "packages/client");

/** Files a client package must not carry: each would be a second role. */
const FORBIDDEN_FILES = ["plugin.ts", "lib.ts"];

/** The one loader entry every client package names. */
const ENTRY = "src/client/index.ts";

const failures: string[] = [];
let checked = 0;

/**
 * Record a failure.
 *
 * @param {string} packageName - the manifest name.
 * @param {string} message - what is wrong.
 */
function fail(packageName: string, message: string): void {
  failures.push(`${packageName}: ${message}`);
}

/**
 * Every `.ts` / `.tsx` file under a directory, recursively.
 *
 * @param {string} dir - the directory to walk.
 * @returns {string[]} absolute file paths.
 */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) files.push(path);
  }
  return files;
}

// An import / re-export clause that names another prac client package. The
// `type` forms are the sanctioned channel and are excluded: `import type`,
// `import type {} from`, and `export type … from`.
const CROSS_PLUGIN_VALUE =
  /(?:^|\n)[ \t]*(?:import|export)\s+(?!type\b)[^;]*?from\s+["'](prac-client-[a-z0-9-]+)(?:\/[^"']*)?["']/g;

for (const dirName of existsSync(clientDir) ? readdirSync(clientDir) : []) {
  const dir = join(clientDir, dirName);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const name = manifest.name;
  checked += 1;

  // 1. The single loader entry, and the pack config that names it.
  if (!existsSync(join(dir, ENTRY))) fail(name, `missing ${ENTRY}`);
  const vitePath = join(dir, "vite.config.ts");
  const vite = existsSync(vitePath) ? readFileSync(vitePath, "utf8") : "";
  if (vite === "") fail(name, "missing vite.config.ts");
  // Comment lines are not configuration: a commented-out call must not fail the
  // gate (and must not count as the entry either).
  const viteCode = vite
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
  const packCalls = [...viteCode.matchAll(/clientPack\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g)];
  if (packCalls.length === 0) fail(name, "no clientPack() call in vite.config.ts");
  for (const [, id, body] of packCalls) {
    if (id !== name) fail(name, `clientPack() id is "${id}"`);
    const entry = /entry:\s*["']([^"']+)["']/.exec(body)?.[1];
    if (entry !== ENTRY)
      fail(name, `clientPack() entry is ${entry ?? "missing"}, expected ${ENTRY}`);
  }

  // 2. No second role as a file, and no library artifact.
  for (const file of FORBIDDEN_FILES) {
    if (existsSync(join(dir, "src/client", file))) fail(name, `src/client/${file} exists`);
  }
  if (manifest.exports?.["./lib"] !== undefined) fail(name, "exports declares ./lib");

  // 3. The row declaration and the loader artifact.
  if (manifest.dsh?.client?.platform !== "web") fail(name, 'dsh.client.platform is not "web"');
  const clientExport = manifest.exports?.["./client"];
  if (clientExport === undefined) fail(name, "exports has no ./client");
  else if (clientExport.default !== "./dist/client.js") {
    fail(
      name,
      `./client default is ${clientExport.default ?? "missing"}, expected ./dist/client.js`,
    );
  }

  // 4. The type-only contract, when declared.
  const types = clientExport?.types;
  if (types !== undefined) {
    if (types !== "./dist/client-types.d.mts") {
      fail(name, `./client types is ${types}, expected ./dist/client-types.d.mts`);
    }
    if (!existsSync(join(dir, "src/client/contract.ts")))
      fail(name, "missing src/client/contract.ts");
  }

  // 5. The artifact-shape assertion.
  if (!viteCode.includes("check:client"))
    fail(name, "vite.config.ts declares no check:client task");

  // 6. No value import / re-export of another client plugin.
  const src = join(dir, "src");
  if (existsSync(src)) {
    for (const file of sourceFiles(src)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(CROSS_PLUGIN_VALUE)) {
        const target = match[1];
        if (target === name) continue;
        fail(
          name,
          `${relative(root, file)} imports ${target} as a value; cross-plugin sharing is a Cordis service`,
        );
      }
    }
  }
}

console.log(`client-entries: checked ${checked} package(s)`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
