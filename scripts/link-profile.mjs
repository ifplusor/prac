#!/usr/bin/env node
/**
 * Link every local DSH plugin/bundle package into a profile.
 *
 * `dsh plugin add` links only the bundle package itself; the bundle patch rows
 * are resolved from the profile's node_modules. This script makes a local
 * profile self-contained by linking the repo's packages and recording them as
 * `link:` dependencies in the profile manifest.
 *
 * Usage:
 *   node scripts/link-profile.mjs --profile prac-dev
 *   node scripts/link-profile.mjs --profile clean --home /tmp/prac-clean-dsh
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const get = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const profileName = get("profile", "prac-dev");
const home = resolve(get("home", process.env.DSH_HOME ?? join(homedir(), ".dsh")));
const profileDir = join(home, "profiles", profileName);
const repo = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = join(profileDir, "package.json");
if (!existsSync(manifestPath)) {
  console.error(`profile manifest not found: ${manifestPath}`);
  process.exit(1);
}

const roots = ["packages/client", "packages/host", "packages/bundle"];
const packages = [];
for (const root of roots) {
  const dir = join(repo, root);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "package.json");
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, "utf8"));
    if (json.private !== true && json.dsh?.bundle === undefined) continue;
    packages.push({ dir: join(dir, name), json });
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.dependencies ??= {};
const modules = join(profileDir, "node_modules");
mkdirSync(modules, { recursive: true });
// A renamed local package leaves a stale `link:` entry and symlink behind; the
// profile must reflect the repo, not the history of its package names.
const known = new Set(packages.map((pkg) => pkg.json.name));
for (const [name, spec] of Object.entries(manifest.dependencies)) {
  if (typeof spec !== "string" || !spec.startsWith("link:") || known.has(name)) continue;
  delete manifest.dependencies[name];
  try {
    unlinkSync(join(modules, name));
  } catch {
    // Already gone.
  }
}
for (const name of readdirSync(modules)) {
  if (known.has(name)) continue;
  const target = join(modules, name);
  try {
    if (!existsSync(target)) unlinkSync(target);
  } catch {
    // Not ours to remove.
  }
}
for (const pkg of packages) {
  const name = pkg.json.name;
  manifest.dependencies[name] = `link:${pkg.dir}`;
  const target = join(modules, name);
  try {
    unlinkSync(target);
  } catch {
    // absent or directory; pnpm's node_modules layout is symlinks
  }
  symlinkSync(pkg.dir, target, "dir");
}
const bundles = new Set(manifest.dsh?.profile?.bundles ?? []);
bundles.add("prac-web-app");
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles = [...bundles];
writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + "\n");

console.log(`linked ${packages.length} local DSH package(s) into ${profileDir}`);
