/**
 * Pixel-level verification of the fused surface: the VS part host must actually
 * render.
 *
 * DOM checks ("the part mounted, no errors") already passed while the editor was
 * invisible, so this script refuses to trust the DOM:
 *
 *  1. geometry — every `[data-vscode-embed-part-host]` host must contain a `.part`
 *     whose box starts at the host origin and fits inside it (no y < 0, no
 *     overflow);
 *  2. paint — screenshot the host clip, decode it in the page, and count distinct
 *     colours. One colour means "structurally present, visually blank" (the exact
 *     failure mode that looked healthy in the DOM);
 *  3. attribution — screenshot the same clip with the host hidden. Identical bytes
 *     mean nothing in that clip came from the host.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' node scripts/verify-regions.mjs
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"));
const upstreamDir = join(workDir, "upstream");
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
await page.waitForSelector("[data-vscode-embed-part-host]", { state: "attached", timeout: 60_000 });
// Give Monaco a beat to paint after the grid lays it out.
await page.waitForTimeout(2500);

const hosts = await page.evaluate(() =>
  [...document.querySelectorAll("[data-vscode-embed-part-host]")].map((host) => {
    const part = host.querySelector(".part");
    const hostBox = host.getBoundingClientRect();
    const partBox = part?.getBoundingClientRect();
    const leaves = [
      ".editor-group-container",
      ".monaco-editor",
      ".tabs",
      ".composite",
      ".pane-composite-part",
      ".monaco-list",
      ".statusbar-item",
    ];
    const leaf = leaves.map((selector) => host.querySelector(selector)).find(Boolean);
    const leafBox = leaf?.getBoundingClientRect();
    return {
      view: host.getAttribute("data-vscode-embed-part-host"),
      hostsPart: !!part,
      host: {
        w: Math.round(hostBox.width),
        h: Math.round(hostBox.height),
        x: Math.round(hostBox.x),
        y: Math.round(hostBox.y),
      },
      partPosition: part ? getComputedStyle(part).position : null,
      partBox: partBox
        ? {
            w: Math.round(partBox.width),
            h: Math.round(partBox.height),
            x: Math.round(partBox.x),
            y: Math.round(partBox.y),
          }
        : null,
      leaf: leaf ? leaf.className.split(" ")[0] : null,
      leafBox: leafBox
        ? {
            w: Math.round(leafBox.width),
            h: Math.round(leafBox.height),
            x: Math.round(leafBox.x),
            y: Math.round(leafBox.y),
          }
        : null,
      text: (host.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80),
    };
  }),
);

const report = [];
for (const entry of hosts) {
  const host = page.locator(`[data-vscode-embed-part-host="${entry.view}"]`);
  const box = await host.boundingBox();
  if (!box || box.width < 2 || box.height < 2) {
    report.push({ ...entry, paint: null, note: "degenerate host box; nothing to sample" });
    continue;
  }
  const clip = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  const painted = await page.screenshot({ clip });
  await page.evaluate((view) => {
    const el = document.querySelector(`[data-vscode-embed-part-host="${view}"]`);
    if (el) el.style.visibility = "hidden";
  }, entry.view);
  const hidden = await page.screenshot({ clip });
  await page.evaluate((view) => {
    const el = document.querySelector(`[data-vscode-embed-part-host="${view}"]`);
    if (el) el.style.visibility = "";
  }, entry.view);

  const analysis = await page.evaluate(analyse, painted.toString("base64"));
  report.push({
    ...entry,
    paint: {
      ...analysis,
      sha: sha(painted).slice(0, 12),
      differsWhenHidden: sha(painted) !== sha(hidden),
    },
  });
}

// A whole-page hash is the cheap regression signal: if a change does not move it,
// the change did not reach the pixels.
const fullPage = sha(await page.screenshot());

await browser.close();

const verdicts = report.map((entry) => {
  const within = (inner) =>
    !!inner &&
    !!entry.host &&
    inner.x >= entry.host.x - 1 &&
    inner.y >= entry.host.y - 1 &&
    inner.w > 0 &&
    inner.h > 0 &&
    inner.x + inner.w <= entry.host.x + entry.host.w + 1 &&
    inner.y + inner.h <= entry.host.y + entry.host.h + 1;
  const checks = {
    hostsPart: entry.hostsPart === true,
    insideHost: within(entry.partBox),
    // The real failure mode: content laid out at a negative offset or oversized,
    // i.e. present in the DOM but drawn outside its own host.
    leafInsideHost: within(entry.leafBox),
    leafFillsHost:
      !!entry.leafBox &&
      !!entry.host &&
      entry.leafBox.w >= entry.host.w * 0.9 &&
      entry.leafBox.h >= entry.host.h * 0.5,
    painted: !!entry.paint && entry.paint.distinctColours > 4 && entry.paint.dominantShare < 0.98,
    attributed: !!entry.paint && entry.paint.differsWhenHidden === true,
  };
  return { view: entry.view, checks, ok: Object.values(checks).every(Boolean) };
});

console.log(
  JSON.stringify(
    {
      url,
      fullPageSha: fullPage.slice(0, 12),
      verdicts,
      report,
      errorCount: errors.length,
      errors: errors.slice(0, 10),
    },
    null,
    2,
  ),
);

const failed = verdicts.filter((verdict) => !verdict.ok);
if (failed.length) {
  console.error(`\nFAILED: ${failed.map((verdict) => verdict.view).join(", ")}`);
  process.exit(1);
}
console.log(`\nOK: ${verdicts.length} VS part host(s) mounted, positioned and painted.`);
