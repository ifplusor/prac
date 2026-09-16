/**
 * Verification of **view-level** hosting: one VS Code view, outside its part.
 *
 * The point of the finer unit is that prac composes views itself: the explorer's
 * file tree is created as its own pane, with no sidebar part anywhere on the
 * page. This script refuses to trust "it mounted":
 *
 *  1. **structure** — a `[data-vscode-embed-view]` host holds the view's own
 *     `.pane`, and no `[data-vscode-embed-part-host="workbench.parts.sidebar"]`
 *     exists;
 *  2. **paint** — screenshot the host clip and count distinct colours, because a
 *     structurally present, visually blank view is the failure mode that looks
 *     healthy in the DOM;
 *  3. **release + recreate** — move the seat to another region, which unmounts
 *     and remounts it, and assert the view is painted again in the new region
 *     (a view instance holds services, so it has to be creatable twice).
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-view.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = join(workDir, "upstream");
const url = process.env.URL;

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

/** The seat prac declares, and the VS Code view it hosts. */
const SEAT = "vscode:sidebar";
const VIEW = "workbench.explorer.fileView";
const VIEW_HOST = `[data-vscode-embed-view="${VIEW}"]`;
/** The part that must NOT be on the page: view hosting replaced it. */
const SIDEBAR_PART_HOST = '[data-vscode-embed-part-host="workbench.parts.sidebar"]';

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
  return [...counts.values()].sort((a, b) => b - a);
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
// The seat is hidden and unplaced by the default arrangement: reveal it in a
// side region, which is where a view composed by prac would go.
await page.evaluate(
  ({ seat }) => {
    globalThis.__pracLayout.show(seat);
    globalThis.__pracLayout.place(seat, "left");
  },
  { seat: SEAT },
);
await page.waitForSelector(VIEW_HOST, { timeout: 60_000 });
await page.waitForTimeout(2000);

/** The view host's structure and paint, plus what else is on the page. */
async function sample() {
  const facts = await page.evaluate(
    ({ viewHost, sidebarPartHost }) => {
      const host = document.querySelector(viewHost);
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
        region: host?.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
        panes: host?.querySelectorAll(".pane").length ?? 0,
        headerTitle: host?.querySelector(".pane-header .title")?.textContent?.trim() ?? null,
        listRows: host?.querySelectorAll(".monaco-list-row").length ?? 0,
        sidebarPartHosts: document.querySelectorAll(sidebarPartHost).length,
        mountErrors: 0,
      };
    },
    { viewHost: VIEW_HOST, sidebarPartHost: SIDEBAR_PART_HOST },
  );
  if (facts.host && facts.host.w > 2 && facts.host.h > 2) {
    const clip = { x: facts.host.x, y: facts.host.y, width: facts.host.w, height: facts.host.h };
    const shot = await page.screenshot({ clip });
    const colours = await page.evaluate(analyse, shot.toString("base64"));
    facts.paint = {
      distinctColours: colours.length,
      topShare: colours[0] / colours.reduce((a, b) => a + b, 0),
    };
  } else {
    facts.paint = null;
  }
  const mountLines = consoleErrors.filter((line) => line.includes("vscode-embed"));
  facts.mountErrors = mountLines.length;
  // Keep the text: a mount failure is logged by the composition, not thrown at
  // the embedder, so the message is the only evidence it happened.
  facts.mountErrorMessages = mountLines.map((line) => line.slice(0, 400));
  return facts;
}

const placed = await sample();
// Move the seat: the old host unmounts (releasing the view) and a new one mounts
// (creating it again) — the release/recreate judgement, exercised through the UI.
await page.evaluate(
  ({ seat }) => {
    globalThis.__pracLayout.place(seat, "stage");
  },
  { seat: SEAT },
);
await page.waitForTimeout(2500);
const moved = await sample();

await browser.close();

const painted = (facts) => facts.paint !== null && facts.paint.distinctColours > 4;
const checks = {
  // The view renders, as its own pane, with the workbench's own header.
  viewHostPresent: placed.host !== null && placed.panes >= 1,
  viewHeaderRendered: placed.headerTitle !== null,
  // It is a view, not the part: no sidebar part host anywhere on the page.
  noSidebarPart: placed.sidebarPartHosts === 0 && moved.sidebarPartHosts === 0,
  // Structurally present is not enough — it has to have pixels.
  viewPainted: painted(placed),
  // Release + recreate: the seat moved regions, so the view was created twice.
  remountLandedInStage: moved.region === "stage" && moved.panes >= 1,
  remountPainted: painted(moved),
  // A failed mount would be logged by the composition, not thrown at the embedder.
  noMountErrors: placed.mountErrors === 0 && moved.mountErrors === 0,
};

console.log(
  JSON.stringify(
    {
      url,
      placed: { ...placed, paint: placed.paint },
      moved: { ...moved, paint: moved.paint },
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
  "OK: the explorer view renders as its own pane in prac's region, with no sidebar part on the page, and survives release + recreate.",
);
