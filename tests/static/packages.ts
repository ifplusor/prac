#!/usr/bin/env node
/**
 * Static dependency gate for the planned UI package split.
 *
 * Every client package is a DSH plugin (or a bundle); the `lib/` packages are
 * the layers those plugins build on. The gate checks that each plugin stays
 * within its service boundary, that a library never reaches back into a plugin,
 * and that the bundle stays a leaf.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const clientDir = join(root, "packages/client");
const bundleDir = join(root, "packages/bundle");
const libDir = join(root, "packages/lib");

/** One package's forbidden edges, with the reason shown on failure. */
interface Rule {
  readonly forbidden?: readonly string[];
  readonly why?: string;
}

const RULES: Record<string, Rule> = {
  "prac-ui-kit-layout": {
    forbidden: [
      "prac-ui-kit-content",
      "prac-ui-kit-workbench",
      "prac-client-ui-frame",
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-dsh-host",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-client-ui-changed-files",
      "prac-web-app",
    ],
    why: "the core is a framework-agnostic kernel; it depends on nothing",
  },
  "prac-ui-kit-content": {
    forbidden: [
      "prac-ui-kit-workbench",
      "prac-client-ui-frame",
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-dsh-host",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-client-ui-changed-files",
      "prac-web-app",
    ],
    why: "L1 content is independent of the workbench frame; frame depends on content",
  },
  "prac-ui-kit-workbench": {
    forbidden: [
      "prac-client-ui-frame",
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-dsh-host",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-client-ui-changed-files",
      "prac-web-app",
    ],
    why: "a library must never import a DSH plugin; the plugin imports the library",
  },

  "prac-client-ui-frame": {
    forbidden: [
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-dsh-host",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-web-app",
    ],
    why: "frame only knows the surface registry",
  },
  "prac-client-ui-widget": {
    forbidden: [
      "prac-client-ui-workbench",
      "prac-client-dsh-host",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-web-app",
    ],
    why: "widget must not import window; adapters are consumers, not dependencies",
  },
  "prac-client-ui-workbench": {
    forbidden: ["prac-web-app"],
    why: "bundle is a composition root and must stay a leaf",
  },
  "prac-client-dsh-host": {
    forbidden: ["prac-web-app"],
    why: "bundle is a composition root and must stay a leaf",
  },
  "prac-client-ui-changed-files": {
    forbidden: ["prac-web-app"],
    why: "bundle is a composition root and must stay a leaf",
  },
  "prac-client-vscode-host": {
    forbidden: ["prac-web-app"],
    why: "bundle is a composition root and must stay a leaf",
  },
  "prac-client-ui-vscode-views": {
    forbidden: ["prac-client-ui-vscode-editor", "prac-web-app"],
    why: "the two VS Code adapters are siblings",
  },
  "prac-client-ui-vscode-editor": {
    forbidden: ["prac-client-ui-vscode-views", "prac-web-app"],
    why: "the two VS Code adapters are siblings",
  },
};

function readPackage(dir: string): { dir: string; file: string; json: any } | undefined {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  return { dir, file, json: JSON.parse(readFileSync(file, "utf8")) };
}

function depsOf(pkg: { json: any }): Set<string> {
  const json = pkg.json;
  return new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
  ]);
}

const packages: { dir: string; file: string; json: any }[] = [];
for (const parent of [libDir, clientDir, bundleDir]) {
  if (!existsSync(parent)) continue;
  for (const name of readdirSync(parent)) {
    const pkg = readPackage(join(parent, name));
    if (pkg) packages.push(pkg);
  }
}

const byName = new Map(packages.map((pkg) => [pkg.json.name, pkg]));
let failed = false;
let checked = 0;
let skipped = 0;

for (const [name, rule] of Object.entries(RULES)) {
  const pkg = byName.get(name);
  if (!pkg) {
    skipped += 1;
    continue;
  }
  checked += 1;
  const deps = depsOf(pkg);
  for (const forbidden of rule.forbidden ?? []) {
    if (deps.has(forbidden)) {
      failed = true;
      console.error(
        `✗ ${name} must not depend on ${forbidden} (${rule.why ?? "package boundary"})`,
      );
    }
  }
}

// The kit layers are DSH-free: a `@deepseek-ai/*` dependency would put the DSH
// runtime (or its declaration records) back into the library.
for (const name of ["prac-ui-kit-layout", "prac-ui-kit-content", "prac-ui-kit-workbench"]) {
  const pkg = byName.get(name);
  if (!pkg) continue;
  for (const dep of depsOf(pkg)) {
    if (dep.startsWith("@deepseek-ai/")) {
      failed = true;
      console.error(`✗ ${name} must not depend on ${dep} (the kit is DSH-free)`);
    }
  }
}

// L2 must consume L1, not redistribute it: workbench may import content types in
// its own signatures, but it must not re-export content modules.
const workbenchSrc = join(libDir, "ui-kit-workbench/src");
if (existsSync(workbenchSrc)) {
  for (const file of readdirSync(workbenchSrc)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(workbenchSrc, file), "utf8");
    if (
      /export\s+(?:type\s+)?\*?\s*\{[^}]*\}\s+from\s+"prac-ui-kit-content"/.test(source) ||
      /export\s+\*\s+from\s+"prac-ui-kit-content"/.test(source)
    ) {
      failed = true;
      console.error(`✗ prac-ui-kit-workbench must not re-export content (${file})`);
    }
  }
}

// The frame layer must not know prac's slot keys or content kinds: those are
// the plugin / application vocabulary. A static literal check is enough here.
const frameSrc = join(libDir, "ui-kit-workbench/src");
if (existsSync(frameSrc)) {
  for (const file of readdirSync(frameSrc)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(frameSrc, file), "utf8");
    if (/["'`]prac\.(view|window|widget)/.test(source)) {
      failed = true;
      console.error(`✗ prac-ui-kit-workbench must not name prac slots (${file})`);
    }
  }
}

// bundle is a leaf: no package other than the bundle itself may depend on it.
for (const pkg of packages) {
  const name = pkg.json.name;
  if (name === "prac-web-app") continue;
  if (depsOf(pkg).has("prac-web-app")) {
    failed = true;
    console.error(`✗ ${name} must not depend on prac-web-app (bundle is a leaf)`);
  }
}

console.log(
  `ui-packages: checked ${checked}, skipped ${skipped} not-yet-split target(s), ${packages.length} package(s) present`,
);
if (failed) process.exit(1);
