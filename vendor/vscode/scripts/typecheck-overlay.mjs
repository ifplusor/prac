/**
 * Type-check the **upstream-tree overlay files** against the real `vs/` tree.
 *
 * The repo's own checker cannot see these files: they import `vs/...` internals by
 * relative path and only compile inside the checkout (see `vendor/vscode/.eslintignore`).
 * Upstream's build bundles them with esbuild, which **does not type-check** — so an
 * overlay class can be written, bundled and shipped with a typo that only shows up at
 * runtime.
 *
 * This script closes that hole: it writes a small project into the checkout that
 * extends the tree's own base config, includes the tree's typings plus the listed
 * overlay files (by their path inside the checkout), and runs the checkout's `tsc`.
 * Everything the tree already knows about itself (lib, typings, module settings) comes
 * from upstream's config; only the file list is ours.
 *
 * Requires the overlay files to have been copied into the checkout at least once
 * (`node scripts/build.mjs`), since the copy step is what puts them on the tree.
 *
 * Usage: node scripts/typecheck-overlay.mjs
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));

/** The overlay files that live on the tree (`overlay/<x>.ts` → `src/vs/workbench/browser/<x>.ts`). */
// `embeddedWorkbench.ts` / `embeddedWebMain.ts` are deliberately not listed yet:
// adding them surfaces ~20 **pre-existing** type errors from a file that has only
// ever been transpiled (unused injected fields, an incomplete `IWorkbenchLayoutService`
// implementation, `ServicesAccessorLike`). Fixing those is its own task; until then
// they would drown out the errors this script exists to catch.
const FILES = [
  "pracEditorPaneHost",
  "pracWindowGroup",
  "pracWindowGroupHost",
  "pracWindowInput",
  "pracWindowPane",
  "pracWindowProjection",
  "embedBridge",
];

const config = {
  extends: "./src/tsconfig.base.json",
  compilerOptions: {
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    preserveConstEnums: true,
    isolatedModules: false,
    types: [
      "@webgpu/types",
      "mocha",
      "semver",
      "sinon",
      "trusted-types",
      "winreg",
      "wicg-file-system-access",
    ],
  },
  include: ["./src/typings", ...FILES.map((name) => `./src/vs/workbench/browser/${name}.ts`)],
};

const missing = FILES.filter(
  (name) => !existsSync(join(workDir, "src/vs/workbench/browser", `${name}.ts`)),
);
if (missing.length > 0) {
  console.error(
    `overlay file(s) not in the checkout: ${missing.join(", ")} — run \`node scripts/build.mjs\` first`,
  );
  process.exit(1);
}

const configPath = join(workDir, "tsconfig.overlay-check.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));

const tsc = join(workDir, "node_modules/.bin/tsc");
const result = spawnSync(tsc, ["-p", configPath, "--pretty", "false"], {
  cwd: workDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
