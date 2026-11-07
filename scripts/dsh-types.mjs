/**
 * Check whether prac's pinned DSH types still match the DSH checkout it runs.
 *
 * prac type-checks against DSH's **published** packages (pinned exactly in
 * `pnpm-workspace.yaml`), which is what makes the repo portable: anyone can
 * install and check it without a DSH checkout. The risk that buys is drift — the
 * checkout a profile actually runs can move ahead of (or be patched away from)
 * the release, and then the compiler checks against types nobody runs.
 *
 * This script answers that risk cheaply: for every DSH package prac depends on,
 * compare the installed `lib/types/**` tree with the checkout's byte for byte,
 * and report the pins against the checkout's versions.
 *
 * Why it does not type-check *against* the checkout directly: a `tsconfig`
 * `paths` override was implemented and rejected. Mapping DSH specifiers to
 * checkout files splits module identity for declaration-merged modules —
 * measured: under the override the seats' `slots.register({ name: 'prac.widget' })`
 * fails overload resolution while `keyof SlotMap` from the same import still
 * shows the key, i.e. `register`'s constraint sits on a second copy of the
 * module. It reports false errors. A mechanism-correct override has to redirect
 * *resolution* (node_modules links / an install-time override), not file paths;
 * see the note `2026-09-13-vs-concept-boundary.md`.
 *
 * The checkout defaults to prac dev's **anchor worktree**
 * (`../../deepseek-harness/dsh-prac-dev`, the branch `prac-dev`), overridable with
 * `--checkout <path>` or `DSH_CHECKOUT`. A machine without that worktree skips the
 * comparison with a note — the pins stay what makes this repository portable.
 *
 * Usage:
 *   node scripts/dsh-types.mjs --compare
 *   node scripts/dsh-types.mjs --compare --checkout /path/to/dsh-worktree
 *
 * Exits non-zero when any compared file differs, so it can sit in a check task.
 *
 * @module scripts/dsh-types
 */

import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/**
 * Read one flag's value.
 *
 * @param name - flag name, without leading dashes.
 * @returns the value, or undefined when the flag is absent.
 */
function flagValue(name) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * The DSH packages prac's own packages depend on, with who declares them.
 *
 * @returns package name → the prac package that declares it.
 */
function dshDependencies() {
  const found = new Map();
  for (const relativeManifest of globSync("packages/*/*/package.json", { cwd: root })) {
    const manifest = JSON.parse(readFileSync(join(root, relativeManifest), "utf8"));
    for (const name of Object.keys(manifest.devDependencies ?? {})) {
      if (name.startsWith("@deepseek-ai/") && !found.has(name)) {
        found.set(name, { declaredBy: manifest.name, dir: dirname(join(root, relativeManifest)) });
      }
    }
  }
  return found;
}

/**
 * The checkout's directory for one package name.
 *
 * @param checkout - absolute checkout path.
 * @param name - the package name to find.
 * @returns the package directory, or undefined when the checkout has no such package.
 */
function checkoutPackageDir(checkout, name) {
  const manifests = [
    ...globSync("packages/*/*/package.json", { cwd: checkout }),
    ...globSync("vendor/*/package.json", { cwd: checkout }),
  ];
  for (const relativeManifest of manifests) {
    const manifest = JSON.parse(readFileSync(join(checkout, relativeManifest), "utf8"));
    if (manifest.name === name) return dirname(join(checkout, relativeManifest));
  }
  return undefined;
}

/**
 * Every declaration file under a package's `lib/types`, keyed by relative path.
 *
 * @param packageDir - the package directory.
 * @returns relative path → absolute path.
 */
function declarationFiles(packageDir) {
  const typesDir = join(packageDir, "lib/types");
  if (!existsSync(typesDir)) return new Map();
  // Declarations only: the checkout's built tree also holds `.js`, which the
  // published tarballs drop, and those differences are not type drift.
  return new Map(globSync("**/*.d.ts", { cwd: typesDir }).map((rel) => [rel, join(typesDir, rel)]));
}

/**
 * Compare one package's installed declarations with the checkout's.
 *
 * @param installedDir - our installed copy.
 * @param checkoutDir - the checkout's copy.
 * @returns the differing relative paths (empty when they match).
 */
function differingFiles(installedDir, checkoutDir) {
  const mine = declarationFiles(installedDir);
  const theirs = declarationFiles(checkoutDir);
  const differing = [];
  for (const [rel, minePath] of mine) {
    const theirPath = theirs.get(rel);
    if (theirPath === undefined) {
      differing.push(`${rel} (only installed)`);
    } else if (!readFileSync(minePath).equals(readFileSync(theirPath))) {
      differing.push(rel);
    }
  }
  for (const rel of theirs.keys()) {
    if (!mine.has(rel)) differing.push(`${rel} (only in the checkout)`);
  }
  return differing.sort((a, b) => a.localeCompare(b));
}

/**
 * The newest modification time of a file tree, or 0 when there is none.
 *
 * @param dir - directory to walk.
 * @returns the newest mtime in milliseconds.
 */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const rel of globSync("**/*", { cwd: dir })) {
    const at = join(dir, rel);
    try {
      const stat = statSync(at);
      if (stat.isFile()) newest = Math.max(newest, stat.mtimeMs);
    } catch {
      // A path that vanished mid-walk is not worth reporting.
    }
  }
  return newest;
}

/**
 * Whether the checkout's declarations look older than its sources.
 *
 * Measured today: `dsh-dev`'s `lib/types` were built before its `src` last
 * changed, so it reported three packages as "drifted" from a release they
 * actually match. A stale build is not drift — it is an unusable comparison, and
 * it has to say so instead of producing false positives.
 *
 * @param packageDir - the checkout's package directory.
 * @returns true when `src` is newer than `lib/types`.
 */
function looksStale(packageDir) {
  const typesNewest = newestMtime(join(packageDir, "lib/types"));
  const srcNewest = newestMtime(join(packageDir, "src"));
  return typesNewest > 0 && srcNewest > typesNewest;
}

/**
 * Compare every DSH package prac depends on against the checkout.
 *
 * @param checkout - absolute checkout path.
 * @returns the number of packages whose declarations differ.
 */
function compare(checkout) {
  let drifted = 0;
  let stale = 0;
  let compared = 0;
  for (const [name, where] of [...dshDependencies()].sort(([a], [b]) => a.localeCompare(b))) {
    // Resolve from the package that declares the dependency: these are
    // per-package devDependencies, not hoisted to the workspace root.
    let installedDir;
    try {
      installedDir = dirname(
        createRequire(join(where.dir, "package.json")).resolve(`${name}/package.json`),
      );
    } catch {
      console.log(`? ${name}: not installed (declared by ${where.declaredBy})`);
      continue;
    }
    const checkoutDir = checkoutPackageDir(checkout, name);
    if (checkoutDir === undefined) {
      console.log(`? ${name}: the checkout publishes no such package`);
      continue;
    }
    const read = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    const installedVersion = read(installedDir);
    const checkoutVersion = read(checkoutDir);
    if (looksStale(checkoutDir)) {
      stale += 1;
      console.log(
        `~ ${name} (${checkoutVersion}): the checkout's build is older than its src — ` +
          "rebuild that worktree before comparing",
      );
      continue;
    }
    const differing = differingFiles(installedDir, checkoutDir);
    compared += 1;
    if (differing.length > 0) drifted += 1;
    const version =
      installedVersion === checkoutVersion
        ? installedVersion
        : `${installedVersion} vs checkout ${checkoutVersion}`;
    console.log(
      `${differing.length === 0 ? "=" : "!"} ${name} (${version})${
        differing.length === 0
          ? ""
          : ` — ${differing.length} differing file(s): ${differing.slice(0, 5).join(", ")}`
      }`,
    );
  }
  console.log(
    `dsh-types: compared ${compared} package(s) — ${
      drifted === 0 ? "the pinned types match the checkout" : `${drifted} differ from the checkout`
    }${stale === 0 ? "" : `; ${stale} could not be compared (stale build)`}`,
  );
  return drifted + stale;
}

/** prac dev's anchor worktree, relative to this repository's root. */
const ANCHOR = "../../deepseek-harness/dsh-prac-dev";

if (!process.argv.includes("--compare")) {
  console.log("usage: node scripts/dsh-types.mjs --compare [--checkout <path>]");
  process.exit(1);
}
const checkoutRoot = resolve(root, flagValue("checkout") ?? process.env.DSH_CHECKOUT ?? ANCHOR);
if (!existsSync(checkoutRoot)) {
  console.log(
    `dsh-types: no anchor worktree at ${checkoutRoot} — skipped ` +
      "(point --checkout or DSH_CHECKOUT at the DSH checkout this machine runs)",
  );
  process.exit(0);
}
process.exit(compare(checkoutRoot) === 0 ? 0 : 1);
