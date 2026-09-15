/**
 * Verify the attention mechanism: the editor part must survive being *moved*
 * between the right track and the centre.
 *
 * A moved part is exactly where a DOM-level check lies: the node is still in the
 * document, still error-free, and blank. So each state is judged on pixels —
 * geometry, colour spread, and whether hiding the region changes the clip.
 *
 * Two hosts can be in the document at once (the collapsed right region keeps its
 * seat), so the part's host is identified by *which one holds it*, and a state
 * that holds it twice is a failure: the part is a single instance.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' node scripts/verify-focus.mjs
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const upstreamDir = join(
  process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"),
  "upstream",
);
const url = process.env.URL;
if (!url) throw new Error("URL is required");
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test")))
  throw new Error("run vscode:build first");

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Decode a PNG in the page and report how much of it is not one flat colour. */
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
  return { distinctColours: counts.size, dominantShare: +(dominant / total).toFixed(4) };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error.message)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-focus-strip]", { timeout: 60_000 });
await page.waitForTimeout(3000);

/** Read the current state: strip, host geometry, and the part's paint. */
async function sample() {
  const facts = await page.evaluate(() => {
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
    // prac's own frame carries `data-prac-frame`; the fallback keeps this script
    // working on DSH's stock `AppFrame` (whose overlay layer is the marker).
    const frame =
      document.querySelector("[data-prac-frame]") ??
      document.querySelector("[data-shell-overlay]")?.parentElement;
    const rightRegion = document.querySelector('[data-prac-region="right"]');
    const hosts = [...document.querySelectorAll("[data-vscode-embed-part-host]")].map(
      (el, index) => ({
        index,
        region: el.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
        holdsEditor: !!el.querySelector(".editor-group-container"),
        box: box(el),
      }),
    );
    return {
      focus:
        document.querySelector("[data-prac-focus-strip]")?.getAttribute("data-prac-focus-strip") ??
        null,
      hasStrip: !!document.querySelector("[data-prac-focus-strip]"),
      frame: box(frame),
      // The track is closed when nothing renders there: an empty fixed region
      // takes no space, so absence reads as width 0.
      rightRegionWidth: rightRegion ? Math.round(rightRegion.getBoundingClientRect().width) : 0,
      // The conversation's own region, from the layout probe: decision 14 made it
      // an ordinary view, so it moves with attention and the gates read it here.
      conversationRegion:
        globalThis.__pracLayout?.getState?.().views?.["dsh:main:conversation"]?.region ?? null,
      hosts,
      tabTitle:
        document
          .querySelector(
            "[data-vscode-embed-part-host] .tab .label-name, [data-vscode-embed-part-host] .tabs .monaco-icon-label",
          )
          ?.textContent?.trim() ?? null,
    };
  });

  const holders = facts.hosts.filter((host) => host.holdsEditor);
  const host = holders[0] ?? null;
  let paint = null;
  if (host && host.box.w > 2 && host.box.h > 2) {
    const clip = { x: host.box.x, y: host.box.y, width: host.box.w, height: host.box.h };
    const painted = await page.screenshot({ clip });
    await page.evaluate((index) => {
      const el = document.querySelectorAll("[data-vscode-embed-part-host]")[index];
      if (el) el.style.visibility = "hidden";
    }, host.index);
    const hidden = await page.screenshot({ clip });
    await page.evaluate((index) => {
      const el = document.querySelectorAll("[data-vscode-embed-part-host]")[index];
      if (el) el.style.visibility = "";
    }, host.index);
    paint = {
      ...(await page.evaluate(analyse, painted.toString("base64"))),
      sha: sha(painted).slice(0, 12),
      differsWhenHidden: sha(painted) !== sha(hidden),
    };
  }
  return { ...facts, host, holderCount: holders.length, paint };
}

const states = {};
states.default = await sample();

// Promote the VS Code view with the keyboard shortcut (also exercises the binding).
await page.keyboard.press("Control+Alt+2");
await page.waitForTimeout(2500);
states.promoted = await sample();

// And back, via the keyboard's back binding.
await page.keyboard.press("Control+Alt+ArrowLeft");
await page.waitForTimeout(2500);
states.back = await sample();

await page.screenshot({ path: resolve(repoRoot, ".build/focus.png") });
await browser.close();

/** How far the part's host centre sits from the frame centre (negative = left). */
const offset = (state) => {
  if (!state.frame || !state.host) return null;
  return state.host.box.x + state.host.box.w / 2 - (state.frame.x + state.frame.w / 2);
};

const checks = {
  // The part is one instance: it can never be in two hosts at once.
  partInOneHost: [states.default, states.promoted, states.back].every(
    (state) => state.holderCount === 1,
  ),
  // Attention is reported by the environment layer, not by a seat we displaced.
  stripPresent: states.default.hasStrip && states.promoted.hasStrip,
  stripFollowsFocus: states.default.focus === "conversation" && states.promoted.focus === "vscode",
  // Promoted: the editor holds the centre, and the track's width went to it.
  // (Where attention *places* the views is the arrangement's rule and a unit
  // test — `web-app`'s `arrangement.spec.ts`; what is live here is the part
  // actually moving between regions and painting in each.)
  promotedEditorCentred:
    states.promoted.host?.region === "stage" && Math.abs(offset(states.promoted)) < 200,
  promotedWiderThanBeside: states.promoted.host.box.w > states.default.host.box.w * 1.3,
  paintedThroughThePromotion:
    states.default.paint?.distinctColours > 4 &&
    states.default.paint.differsWhenHidden === true &&
    states.promoted.paint?.distinctColours > 4 &&
    states.promoted.paint.differsWhenHidden === true,
  // The move must not lose the editor's content.
  contentSurvivesMove: !!states.promoted.tabTitle && !!states.back.tabTitle,
  // Back returns attention to where it was.
  backReturns:
    states.back.focus === "conversation" &&
    states.back.host?.region === "right" &&
    offset(states.back) > 200,
  paintedAfterBack:
    states.back.paint?.distinctColours > 4 && states.back.paint.differsWhenHidden === true,
};

console.log(
  JSON.stringify(
    { url, checks, states, errorCount: errors.length, errors: errors.slice(0, 6) },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length) {
  console.error(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "\nOK: attention moves the editor part between the track and the centre, and it still paints.",
);
