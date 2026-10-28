#!/usr/bin/env node
/**
 * Static dependency gate for the planned UI package split.
 *
 * Every client package is a DSH plugin (or a bundle). The gate checks that each
 * plugin stays within its service boundary and that the bundle stays a leaf.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const clientDir = join(root, "packages/client");
const bundleDir = join(root, "packages/bundle");

/** @typedef {{ forbidden?: readonly string[], why?: string }} Rule */

/** @type {Record<string, Rule>} */
const RULES = {
  "prac-client-ui-frame": {
    forbidden: [
      "prac-client-ui-window",
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-ui-dsh",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-web-app",
    ],
    why: "frame only knows the surface registry",
  },
  "prac-client-ui-window": {
    forbidden: [
      "prac-client-ui-widget",
      "prac-client-ui-workbench",
      "prac-client-ui-dsh",
      "prac-client-vscode-host",
      "prac-client-ui-vscode-views",
      "prac-client-ui-vscode-editor",
      "prac-web-app",
    ],
    why: "window must not import widget; adapters are consumers, not dependencies",
  },
  "prac-client-ui-widget": {
    forbidden: [
      "prac-client-ui-window",
      "prac-client-ui-workbench",
      "prac-client-ui-dsh",
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
  "prac-client-ui-dsh": {
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

function readPackage(dir) {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  return { dir, file, json: JSON.parse(readFileSync(file, "utf8")) };
}

function depsOf(pkg) {
  const json = pkg.json;
  return new Set([
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.devDependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
  ]);
}

const packages = [];
for (const parent of [clientDir, bundleDir]) {
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
