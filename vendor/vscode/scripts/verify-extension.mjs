/**
 * Verification of the **extension base**: a real third-party extension activates
 * and its UI contribution can be rendered inside prac.
 *
 * The composition boots the standard `server` distro as its extension base, and
 * an extension's view descriptors exist only once that extension has activated —
 * so a view of GitLens' rendering inside prac is the proof, not a log line:
 *
 *  1. **mount** — ask the embed face for a view the extension contributes
 *     (`mountViewInto`), into an element this script owns;
 *  2. **render** — the view brings its own pane, with a title, and has pixels
 *     (screenshot + colour count: "structurally present, visually blank" is the
 *     failure mode that looks healthy in the DOM);
 *  3. **release** — dispose it again, so a second extension view can be created.
 *
 * Usage:
 *   URL='http://127.0.0.1:3084/?token=...' node scripts/verify-extension.mjs
 *   VIEW=gitlens.views.repositories URL='…' node scripts/verify-extension.mjs
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = join(workDir, "upstream");
const url = process.env.URL;
/** The extension this gate needs, and one of the views it contributes. */
const extension = process.env.EXTENSION ?? "eamodio.gitlens";
const view = process.env.VIEW ?? "gitlens.views.welcome";
/**
 * Where the server's user extensions live. Installing one is a deliberate,
 * reviewed act (the CLI refuses to run outside a VS Code terminal), so this gate
 * **skips loudly** rather than failing when none is installed.
 */
const extensionsDir = resolve(
  process.env.EXTENSIONS_DIR ?? join(workDir, "..", "vscode-server", "server", "extensions"),
);

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const installed =
  existsSync(extensionsDir) &&
  readdirSync(extensionsDir).some((entry) => entry.startsWith(`${extension}-`));
if (!installed) {
  console.log(
    `SKIPPED: ${extension} is not installed in ${extensionsDir}.\n` +
      "This gate needs a real extension on the server base; installing one is a",
    "deliberate act (see the README's 扩展基座 section). It is a SKIP, not a pass.",
  );
  process.exit(0);
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const analyse = async (base64) => {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts.size;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
// The embed face arrives with the composition's bridge; the page loads it lazily.
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });

/**
 * Whether to mount the view this extension contributes. An extension with **no**
 * views (a linter, a spell checker) proves itself through the capability instead:
 * its diagnostics are its UI, and reading them is a stronger activation proof than
 * a panel would be.
 */
const expectsView = view !== "none";
let mounted = {};
let facts = { panes: 0, headerTitle: null, distinctColours: 0, host: null };
let released = false;
if (expectsView) {
  const mountedView = await page.evaluate((viewId) => {
    const host = document.createElement("div");
    host.id = "prac-extension-probe";
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "640px",
      height: "520px",
      zIndex: "2147483647",
      background: "#1e1e1e",
      overflow: "hidden",
    });
    document.body.appendChild(host);
    globalThis.__vscodeEmbed.face.mountViewInto(viewId, host);
    return { viewId };
  }, view);

  // First mount activates the extension (view contributions imply `onView:`), which
  // takes as long as loading an extension's bundle does.
  await page.waitForSelector("#prac-extension-probe .pane", { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  facts = await page.evaluate(() => {
    const host = document.querySelector("#prac-extension-probe");
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    return {
      host: box(host),
      panes: host?.querySelectorAll(".pane").length ?? 0,
      headerTitle:
        host?.querySelector(".pane-header .title")?.textContent?.trim() ??
        host?.querySelector(".pane-header")?.textContent?.trim() ??
        null,
      bodyText: (host?.querySelector(".pane-body")?.textContent ?? "").trim().slice(0, 120),
    };
  });

  if (facts.host && facts.host.w > 2 && facts.host.h > 2) {
    const shot = await page.screenshot({
      clip: { x: facts.host.x, y: facts.host.y, width: facts.host.w, height: facts.host.h },
    });
    facts.distinctColours = await page.evaluate(analyse, shot.toString("base64"));
  } else {
    facts.distinctColours = 0;
  }

  // Release it again: an extension view has to be creatable twice, like any view.
  released = await page.evaluate((viewId) => {
    globalThis.__vscodeEmbed.face.releaseView(viewId);
    const host = document.querySelector("#prac-extension-probe");
    document.body.removeChild(host);
    return true;
  }, view);
  mounted = mountedView;
}

// The capability phase, for any extension: what it *knows*, read through the same
// handle an agent would use. This is the acceptance criterion for the whole
// capability layer — "an installed extension activates and its knowledge is
// reachable" — without asking a view for permission.
const capabilityFacts = await page.evaluate(async () => {
  const folder = (globalThis.__vscodeEmbed.face.workspaceInfo().folders ?? [])[0] ?? null;
  if (folder === null) throw new Error("the workbench has no workspace folder");
  // A file has to be open (and its model loaded) for an extension to have anything
  // to say about it: diagnostics are per resource.
  globalThis.__vscodeEmbed.face.openFile(`${folder}/AGENTS.md`);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const started = performance.now();
  await globalThis.__vscodeEmbed.face.capabilities.diagnostics.settled();
  const settledMs = Math.round(performance.now() - started);
  const diagnostics = globalThis.__vscodeEmbed.face.capabilities.diagnostics;
  return {
    folder,
    settledMs,
    summary: diagnostics.snapshot().summary,
    version: diagnostics.version(),
    entries: diagnostics.query({ limit: 5 }).entries.map((entry) => ({
      resource: entry.resource,
      source: entry.source ?? null,
      severity: entry.severity,
      message: entry.message.slice(0, 60),
    })),
  };
});

await browser.close();

const mountErrors = consoleErrors.filter((line) => line.includes("vscode-embed"));
const checks = {
  // The extension's knowledge reaches the capability layer: markers that name a
  // source arrived, and `settled()` waited for them instead of answering early.
  capabilitySeesTheExtension:
    capabilityFacts.entries.length > 0 &&
    capabilityFacts.entries.every((entry) => entry.source !== null),
  capabilitySettledOnArrival: capabilityFacts.settledMs >= 300,
  capabilityVersionMoved: capabilityFacts.version > 0,
  capabilitySummaryCounts:
    capabilityFacts.summary.error +
      capabilityFacts.summary.warning +
      capabilityFacts.summary.info +
      capabilityFacts.summary.hint >
    0,
  // A view-contributing extension also has to mount, title itself and paint.
  ...(expectsView
    ? {
        viewMounted: facts.panes >= 1,
        viewTitled: facts.headerTitle !== null && facts.headerTitle.length > 0,
        viewPainted: facts.distinctColours > 4,
        viewReleased: released === true,
      }
    : {}),
  noMountErrors: mountErrors.length === 0,
};

console.log(
  JSON.stringify(
    { url, extension, view, ...mounted, facts, capabilityFacts, checks, mountErrors },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  expectsView
    ? `OK: ${view} — contributed by ${extension} — renders inside prac, and the extension's diagnostics reach the capability layer.`
    : `OK: ${extension} is active on the server base: its diagnostics reach the capability layer with a source, and settled() waited for them.`,
);
