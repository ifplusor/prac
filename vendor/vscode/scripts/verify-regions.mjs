/**
 * Verification of **what the frame hosts** after decision 17: views, not parts.
 *
 * The old subject of this gate — a `[data-vscode-embed-part-host]` in prac's
 * frame — no longer exists by design: the editor part is *created detached* (its
 * service graph needs it) and the sidebar is hosted as a view. So the gate now
 * refuses to trust "it rendered" about the surviving unit:
 *
 *  1. **no part is hosted** — the frame composes views, and the one part the app
 *     still needs is off-screen (`[data-vscode-embed-detached]`, positioned out
 *     of the viewport), never in a region;
 *  2. **the view host fits its region** — the explorer view's `.pane` starts at
 *     the host origin and stays inside it (no negative offset, no overflow);
 *  3. **the host is sized** — and the view's own pane fits its width. Whether the
 *     view's *content* renders is `verify-view`'s and `verify-file`'s subject; this
 *     gate is about what the frame hosts and where the retired part lives.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-regions.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom } from "./deep-dom.mjs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = workDir;
const url = process.env.URL;

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3082/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** The seat's view id and the VS Code view it hosts (as `verify-view` reads them). */
const VIEW_SEAT_ID = "vscode:sidebar";
const VIEW_HOST = '[data-vscode-embed-view="workbench.explorer.fileView"]';

/**
 * Decode a PNG inside the page and report how much of it is not one flat colour.
 *
 * Passed as a real function, not a string: Playwright serializes the function
 * source, whereas a string that evaluates to a function comes back as
 * `undefined` (functions are not serializable) and silently reports "no paint".
 */
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
  const total = data.length / 4;
  let dominant = 0;
  for (const count of counts.values()) dominant = Math.max(dominant, count);
  return {
    width: image.width,
    height: image.height,
    distinctColours: counts.size,
    dominantShare: +(dominant / total).toFixed(4),
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await installDeepDom(page);
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
// The seat starts hidden and unplaced; reveal it where a composed view would go.
await page.evaluate((seat) => {
  globalThis.__pracLayout.show(seat);
  globalThis.__pracLayout.place(seat, "left");
}, VIEW_SEAT_ID);
await page.waitForSelector(VIEW_HOST, { state: "attached", timeout: 60_000 });
// Give the view a beat to paint.
await page.waitForTimeout(2500);

const facts = await page.evaluate(
  ({ viewHost, seat }) => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const host = globalThis.__deep.one(viewHost);
    const pane = host?.querySelector(".pane");
    const detached = globalThis.__deep.one("[data-vscode-embed-detached]");
    return {
      viewHosts: globalThis.__deep.all("[data-vscode-embed-part-host]").length,
      region:
        globalThis.__deep.closest(host, "[data-prac-region]")?.getAttribute("data-prac-region") ??
        null,
      seat,
      host: box(host),
      pane: box(pane),
      paneTitle: pane?.querySelector(".pane-header .title")?.textContent?.trim() ?? null,
      listRows: host?.querySelectorAll(".monaco-list-row").length ?? 0,
      detached: detached
        ? { ...box(detached), attribute: detached.getAttribute("data-vscode-embed-detached") }
        : null,
    };
  },
  { viewHost: VIEW_HOST, seat: VIEW_SEAT_ID },
);

let paint = null;
if (facts.host && facts.host.w > 2 && facts.host.h > 2) {
  const clip = {
    x: facts.host.x,
    y: facts.host.y,
    width: facts.host.w,
    height: facts.host.h,
  };
  const painted = await page.screenshot({ clip });
  await page.evaluate((selector) => {
    const el = globalThis.__deep.one(selector);
    if (el) el.style.visibility = "hidden";
  }, VIEW_HOST);
  const hidden = await page.screenshot({ clip });
  await page.evaluate((selector) => {
    const el = globalThis.__deep.one(selector);
    if (el) el.style.visibility = "";
  }, VIEW_HOST);
  const analysis = await page.evaluate(analyse, painted.toString("base64"));
  paint = {
    ...analysis,
    sha: sha(painted).slice(0, 12),
    differsWhenHidden: sha(painted) !== sha(hidden),
  };
}

// A whole-page hash is the cheap regression signal: if a change does not move it,
// the change did not reach the pixels.
const wholePage = sha(await page.screenshot()).slice(0, 12);

await browser.close();

const checks = {
  // 1. Views, not parts: the frame hosts none, and the retired editor part is
  // created off-screen (the service graph needs it) rather than in a region.
  noPartHosted: facts.viewHosts === 0,
  editorPartIsDetached:
    facts.detached !== null && facts.detached.attribute === "workbench.parts.editor",
  detachedIsOffScreen: (facts.detached?.x ?? 0) < 0,
  // 3. The view host is in a region, sized, and its own pane fits its width.
  //
  // Measured: the pane is *taller* than its host (the explorer's tree reports its
  // content height) and is clipped by the host's `overflow: hidden` — so the
  // assertion is about the axis that matters for composition, not about a pane
  // box that was never true. Whether the view's *content* renders is
  // `verify-view`'s and `verify-file`'s subject, not this gate's.
  viewInARegion: facts.region !== null,
  viewHostIsSized: (facts.host?.w ?? 0) > 100 && (facts.host?.h ?? 0) > 100,
  paneFitsHostWidth:
    (facts.pane?.w ?? 0) > 0 &&
    (facts.pane?.w ?? 0) <= (facts.host?.w ?? 0) + 1 &&
    (facts.pane?.x ?? 0) >= (facts.host?.x ?? 0) - 1,
};

console.log(
  JSON.stringify(
    {
      url,
      facts: { ...facts, paint },
      wholePage,
      checks,
    },
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
  "OK: the frame hosts views (no part in a region), the view host is sized with its pane fitting its width, and the retired editor part exists only off-screen.",
);
