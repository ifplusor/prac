#!/usr/bin/env node
/**
 * Reproducible build for the patch-vendored VS Code this repo owns.
 *
 * VS Code is vendored here as a **pin + patch set + build recipe**, not as
 * source: upstream (Code - OSS) is fetched at the tag pinned in `package.json`
 * (`prac.vscode`) into a gitignored work directory, reset to that pristine tag,
 * and patched with `patches/*.patch` — that patch set is prac's only change to
 * it. The build then produces two bundles: the web workbench (`out-vscode-web`)
 * and the code server (`out-vscode-reh`). The independent viewing page is not
 * staged — `scripts/serve.mjs` serves `scripts/page.html` and the bundle itself.
 *
 * Steps:
 *   1. ensure the upstream checkout at the pinned tag
 *   2. install dependencies (root + the `build/` toolchain)
 *   3. copy the codicon font the web bundle references
 *   4. transpile `src/` -> `out-build`
 *   5. bundle -> `out-vscode-web` (target `web`) 与 `out-vscode-reh` (target `server`), both with NLS
 *
 * Everything the build produces lives inside the checkout, i.e. under
 * `PRAC_VSCODE_DIR` (default `<repo>/.build/vscode`, gitignored). Tool caches
 * (npm / node-gyp / playwright) use the machine's defaults, so the build does
 * write outside the repository.
 *
 * Usage:
 *   node scripts/build.mjs [--force] [--skip-install] [--skip-build]
 *     --force         wipe the work directory and rebuild from scratch
 *     --skip-install  reuse an existing dependency install
 *     --skip-build    only ensure checkout/install, do not transpile/bundle
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const scriptDir = import.meta.dirname;
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "../..");

const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const pin = pkg.prac?.vscode;
if (!pin?.repository || !pin?.tag) {
  throw new Error("package.json is missing prac.vscode { repository, tag }");
}

const flags = new Set(process.argv.slice(2));
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = workDir;
/** @param {string} step @param {string} message */
function log(step, message) {
  console.log(`[prac-vscode] ${step}: ${message}`);
}

/**
 * @param {string} command @param {string[]} args
 * @param {string} [cwd] @param {{ tolerant?: boolean }} [options]
 */
function run(command, args, cwd = upstreamDir, options = {}) {
  log("run", `${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0 && !options.tolerant) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result.status;
}

/** The exact tag currently checked out in the upstream work tree, if any. */
function currentTag() {
  const result = spawnSync("git", ["-C", upstreamDir, "describe", "--tags", "--exact-match"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function ensureCheckout() {
  if (flags.has("--force")) rmSync(workDir, { recursive: true, force: true });
  if (!existsSync(join(upstreamDir, ".git"))) {
    rmSync(upstreamDir, { recursive: true, force: true });
    mkdirSync(dirname(upstreamDir), { recursive: true });
    log("upstream", `cloning ${pin.repository}#${pin.tag}`);
    run(
      "git",
      ["clone", "--depth", "1", "--branch", pin.tag, pin.repository, upstreamDir],
      workDir,
    );
  } else {
    const tag = currentTag();
    if (tag !== pin.tag) {
      log("upstream", `checking out ${pin.tag} (was ${tag ?? "unknown"})`);
      run(
        "git",
        ["fetch", "--depth", "1", "origin", `refs/tags/${pin.tag}:refs/tags/${pin.tag}`],
        upstreamDir,
        { tolerant: true },
      );
      resetCheckout();
    }
  }
  warnDrift();
  applyPatches();
  stageOverlay();
}

/**
 * Put the checkout back on the pinned tag: tracked edits and untracked files go.
 * `git clean -fd` (no `-x`) keeps ignored paths, so `node_modules` and build output
 * survive. A build does this only when the pin moves; `vscode:clean` runs it on demand.
 */
function resetCheckout() {
  log("upstream", `resetting to pristine ${pin.tag}`);
  run("git", ["checkout", "--force", pin.tag]);
  run("git", ["clean", "-fd"]);
}

/**
 * Checkout paths this package is expected to touch: the patch targets, the stamped
 * root `product.json`, and the {@link OVERLAY} destinations. Untracked directories
 * holding build output (`out-*`) are ignored by upstream's `.gitignore` and never
 * show up in `git status`.
 */
function expectedPaths() {
  const expected = new Set(["product.json"]);
  const patchesDir = join(packageDir, "patches");
  if (existsSync(patchesDir)) {
    for (const file of readdirSync(patchesDir).filter((name) => name.endsWith(".patch"))) {
      const patch = readFileSync(join(patchesDir, file), "utf8");
      for (const [, target] of patch.matchAll(/^\+\+\+ b\/(.+)$/gm)) expected.add(target.trim());
    }
  }
  for (const { to } of OVERLAY) expected.add(to);
  return expected;
}

/**
 * Report — never correct — anything modified in the checkout that this recipe did not
 * write. The checkout is a build work tree, not a second source of truth; a foreign edit
 * would silently end up in the bundle, so it is worth one line of warning. `vscode:clean`
 * is the way out.
 */
function warnDrift() {
  const result = spawnSync("git", ["-C", upstreamDir, "status", "--porcelain"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return;
  const expected = expectedPaths();
  const unexpected = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop().trim())
    .filter((path) => !expected.has(path));
  if (unexpected.length === 0) return;
  log(
    "drift",
    `unexpected changes in ${upstreamDir} (kept, not corrected): ${unexpected.join(", ")}`,
  );
  log("drift", "run `vp run --filter prac-vscode vscode:clean` to return to the pinned tag");
}

/**
 * Files this package places into the checkout.
 *
 * `patches/` carries only the *delta* to upstream files (two small edits). Our own
 * files — the payload the edits import, and the bridge contract both sides compile
 * against — live here and are placed at the paths upstream's build expects.
 *
 * `to` is checkout-relative.
 */
const OVERLAY = [
  { from: "overlay/embedBridge.ts", to: "src/vs/workbench/browser/embedBridge.ts" },
  // The bridge re-exports the gallery, so the checkout-side contract needs it as a
  // sibling. It was missing from this table, which only showed up on a build whose
  // checkout had just been cleaned (2026-09-16).
  { from: "overlay/extensionsGallery.ts", to: "src/vs/workbench/browser/extensionsGallery.ts" },
  {
    from: "overlay/chatParticipant.contribution.ts",
    to: "src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts",
  },
  { from: "overlay/embeddedWorkbench.ts", to: "src/vs/workbench/browser/embeddedWorkbench.ts" },
  { from: "overlay/pracEditorPaneHost.ts", to: "src/vs/workbench/browser/pracEditorPaneHost.ts" },
  { from: "overlay/pracWindowInput.ts", to: "src/vs/workbench/browser/pracWindowInput.ts" },
  {
    from: "overlay/pracWindowProjection.ts",
    to: "src/vs/workbench/browser/pracWindowProjection.ts",
  },
  { from: "overlay/pracWindowPane.ts", to: "src/vs/workbench/browser/pracWindowPane.ts" },
  { from: "overlay/pracWindowGroup.ts", to: "src/vs/workbench/browser/pracWindowGroup.ts" },
  { from: "overlay/pracWindowGroupHost.ts", to: "src/vs/workbench/browser/pracWindowGroupHost.ts" },
  { from: "overlay/pracTurnDiff.ts", to: "src/vs/workbench/browser/pracTurnDiff.ts" },
  { from: "overlay/embeddedWebMain.ts", to: "src/vs/workbench/browser/embeddedWebMain.ts" },
];

/**
 * Place {@link OVERLAY} into the checkout. Always overwrites, so the copy here stays the
 * only copy this repository answers for.
 */
function stageOverlay() {
  for (const { from, to } of OVERLAY) {
    const source = join(packageDir, from);
    const dest = join(upstreamDir, to);
    if (!existsSync(source)) throw new Error(`missing overlay file: ${source}`);
    cpSync(source, dest);
    log("overlay", `${from} → ${to}`);
  }
}

/**
 * Apply every `patches/*.patch` (name order) onto the checkout. A patch that is already
 * in place is skipped: `git apply --check -R` succeeding means the tree already carries
 * it, which is the normal case for the second and later builds at the same pin.
 */
function applyPatches() {
  const patchesDir = join(packageDir, "patches");
  if (!existsSync(patchesDir)) return;
  for (const patch of readdirSync(patchesDir)
    .filter((file) => file.endsWith(".patch"))
    .sort()) {
    const file = join(patchesDir, patch);
    if (canReverse(file)) {
      log("patch", `already applied ${patch}`);
      continue;
    }
    run("git", ["apply", "--whitespace=nowarn", file]);
    log("patch", `applied ${patch}`);
  }
}

/** True when `patch` applies in reverse, i.e. the checkout already carries it. */
function canReverse(patch) {
  const result = spawnSync("git", ["apply", "--check", "-R", patch], {
    cwd: upstreamDir,
    stdio: "ignore",
  });
  return result.status === 0;
}

function ensureInstall() {
  if (flags.has("--skip-install")) {
    log("install", "skipped (--skip-install)");
    return;
  }
  // Root: JS deps + devDeps only. Lifecycle scripts are skipped on purpose — the
  // ones a consumer environment cannot run (node-gyp native builds, the playwright
  // browser download, the copilot extension postinstall) are not needed to build the
  // web workbench. The few
  // files other postinstall steps would generate (extension API proposals, extension
  // points) are committed upstream, so a checkout already has them.
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--legacy-peer-deps",
    "--loglevel=error",
  ]);
  // The build toolchain is a separate package with its own lockfile; esbuild needs its
  // postinstall to verify the platform binary.
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", "--loglevel=error"],
    join(upstreamDir, "build"),
  );
}

function copyCodicons() {
  const dest = join(upstreamDir, "src/vs/base/browser/ui/codicons/codicon/codicon.ttf");
  if (existsSync(dest)) {
    log("codicons", "already present");
    return;
  }
  const source = join(upstreamDir, "node_modules/@vscode/codicons/dist/codicon.ttf");
  if (!existsSync(source)) throw new Error(`codicon.ttf not found at ${source}`);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest);
  log("codicons", "copied codicon.ttf into the source tree");
}

function buildBundle() {
  if (flags.has("--skip-build")) {
    log("build", "skipped (--skip-build)");
    return;
  }
  run("node", ["build/next/index.ts", "transpile", "--out", "out-build"]);
  run("node", [
    "build/next/index.ts",
    "bundle",
    "--out",
    "out-vscode-web",
    "--target",
    "web",
    "--nls",
  ]);
  // The extension base: the standard `server` target, not `server-web`. It is
  // what the browser talks to (WebSocket management + extension host) and what
  // decides which extensions count as installable. `--nls` is required — without
  // it the build fails on the missing `nls.messages.json`.
  run("node", [
    "build/next/index.ts",
    "bundle",
    "--out",
    "out-vscode-reh",
    "--target",
    "server",
    "--nls",
  ]);
}

/**
 * Stamp the checked-out commit into the server distro's `product.json`.
 *
 * Both sides derive their product segment with VS Code's own
 * `getServerProductSegment(product) = \`${quality ?? 'oss'}-${commit ?? 'dev'}\``,
 * and they read **different copies** of `product.json`: the web client's is
 * injected at bundle time (so it carries the real commit), while the server
 * distro's is read at runtime. Left unstamped, the server computes `oss-dev`
 * while the client asks for `/oss-<commit>` — every remote-resource request 404s
 * and the extension-host upgrade never lands, which presents as "the editor
 * cannot open files" rather than as a path mismatch.
 *
 * Stamping makes the two copies agree by construction, so the host's
 * `codeServerPath()` derives the one segment both channels actually use.
 */
/** The extension gallery both planes are configured from (the vendor's own module). */
const { EXTENSIONS_GALLERY: gallery } = await import("../overlay/extensionsGallery.ts");

function stampServerCommit() {
  const commit = checkoutCommit();
  if (commit === undefined) throw new Error("cannot resolve the upstream checkout commit to stamp");
  let stamped = 0;
  // The OSS `product.json` ships **no** extension gallery, so the product's own
  // install path (`workbench.extensions.installExtension`) has nothing to talk to:
  // the Extensions view is empty and installing by id fails. The ecosystem is the
  // point of embedding VS Code at all (decision 18's criterion is "a real
  // extension activates"), so the gallery is stamped in here — read from the same
  // `overlay/extensionsGallery.ts` the client passes to the workbench, so the two
  // planes cannot drift.

  // The flat `server` build reads the **checkout root's** product.json at runtime
  // (its script dir has none), while the web bundle bakes the commit in from
  // `.git/HEAD` at build time — so both copies have to agree, which is what
  // stamping the root does.
  for (const distro of [".", "out-vscode-reh"]) {
    const productPath = join(upstreamDir, distro, "product.json");
    if (!existsSync(productPath)) {
      log("server", `${distro}: no product.json to stamp (not built)`);
      continue;
    }
    const product = JSON.parse(readFileSync(productPath, "utf8"));
    if (product.commit === commit && product.extensionsGallery !== undefined) {
      log("server", `${distro}: already stamped (${commit.slice(0, 10)})`);
      continue;
    }
    product.commit = commit;
    product.extensionsGallery = gallery;
    writeFileSync(productPath, `${JSON.stringify(product, null, "\t")}\n`);
    log("server", `${distro}: stamped commit=${commit.slice(0, 10)} + extensionsGallery`);
    stamped += 1;
  }
  if (stamped === 0) log("server", "nothing to stamp");
}

/**
 * Build the VS Code built-in extensions the rig needs, one by one.
 *
 * The repo-wide extension build is blocked by an unrelated typecheck
 * (`extensions/ipynb`), so every built-in prac wants is compiled here, directly,
 * with the checkout's own `tsc`. Skipping this is not cosmetic: the extension host
 * walks `<checkout>/extensions` (see `prac-host-vscode`'s `language.ts`), so an
 * extension whose `out/` is missing is *scanned* and then fails to activate with
 * `Cannot find module …/out/extension` — which is how "VS Code ships a JS/TS
 * language server" still turned into "the Outline has no symbols for a `.ts` file".
 *
 * Two dependency trees come with it, and both are load-bearing: the shared
 * `extensions/node_modules` holds the `typescript` package the TS extension spawns
 * (`extensions/node_modules/typescript/lib/tsserver.js` — the root alias,
 * `@typescript/typescript6`, does not ship that entry), and each extension's own
 * `node_modules` holds what its code requires at activation.
 */
const BUILTIN_EXTENSIONS = [
  "css-language-features/client",
  "css-language-features/server",
  "markdown-language-features",
  "typescript-language-features",
];

function buildBuiltinExtensions() {
  if (flags.has("--skip-extensions")) {
    log("extensions", "skipped (--skip-extensions)");
    return;
  }
  const install = (dir) =>
    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", "--loglevel=error"],
      dir,
    );
  install(join(upstreamDir, "extensions"));
  for (const dir of BUILTIN_EXTENSIONS) {
    const extension = join(upstreamDir, "extensions", dir);
    install(extension);
    run(join(upstreamDir, "node_modules/.bin/tsc"), ["-p", extension, "--pretty", "false"]);
    log("extensions", `built ${dir}`);
  }
}

/**
 * The commit the upstream checkout has checked out, read the way VS Code's own
 * `build/lib/git.ts` does (`.git/HEAD` is a detached commit or a `ref:`).
 *
 * @returns the 40-hex commit, or `undefined` when it cannot be read.
 */
function checkoutCommit() {
  try {
    const head = readFileSync(join(upstreamDir, ".git/HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return undefined;
    const value = readFileSync(join(upstreamDir, ".git", ref[1]), "utf8").trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

ensureCheckout();
ensureInstall();
copyCodicons();
buildBuiltinExtensions();
buildBundle();
stampServerCommit();
console.log("[prac-vscode] done. serve it with: vp run --filter prac-vscode vscode:serve");
