/**
 * Verification of **stacked regions**: several views in one side region, each
 * with its own header, foldable — while a region holding one view stays bare.
 *
 * The point is that prac groups views itself (`container` is the workbench's
 * grouping, the frame does not need it):
 *
 *  1. **bare by default** — the default arrangement puts one visible view in
 *     `left`, and that region must render exactly as it did before stacking
 *     existed (no headers, no extra chrome) — otherwise this is a redesign of
 *     the default layout, not a capability;
 *  2. **stacked when there are two** — a second visible view in the same region
 *     stacks with headers, both bodies have height, and the region still has
 *     pixels;
 *  3. **fold** — folding one view keeps its header and grows the other, both
 *     through the layout face and through a real click on the header.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-stack.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"));
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

/** The region that stacks, and the two views it gets. */
const REGION = "left";
const BASE_VIEW = "dsh:sidebar";
const ADDED_VIEW = "vscode:sidebar";

const analyse = async (base64) => {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const counts = new Set();
  for (let i = 0; i < data.length; i += 4) {
    counts.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
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
await page.waitForFunction(() => !!globalThis.__pracLayout, null, { timeout: 60_000 });
await page.waitForTimeout(1500);

/** The stack entries of the region, with their boxes and fold state. */
async function sample() {
  const facts = await page.evaluate(
    ({ region }) => {
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
      const host = document.querySelector(`[data-prac-region="${region}"]`);
      const entries = [...(host?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map(
        (entry) => ({
          view: entry.getAttribute("data-prac-stack-entry"),
          collapsed: entry.getAttribute("data-prac-stack-collapsed") === "true",
          entry: box(entry),
          header: box(entry.querySelector("[data-prac-stack-toggle]")),
          body: box(entry.querySelector("[data-prac-stack-body]")),
        }),
      );
      return { region: box(host), entries };
    },
    { region: REGION },
  );
  if (facts.region && facts.region.w > 2 && facts.region.h > 2) {
    const shot = await page.screenshot({
      clip: {
        x: facts.region.x,
        y: facts.region.y,
        width: facts.region.w,
        height: facts.region.h,
      },
    });
    facts.distinctColours = await page.evaluate(analyse, shot.toString("base64"));
  } else {
    facts.distinctColours = 0;
  }
  return facts;
}

const initial = await sample();

// A second visible view in the same region: the stack appears.
await page.evaluate(
  ({ region, view }) => {
    globalThis.__pracLayout.show(view);
    globalThis.__pracLayout.place(view, region);
  },
  { region: REGION, view: ADDED_VIEW },
);
await page.waitForSelector(
  `[data-prac-region="${REGION}"] [data-prac-stack-entry="${ADDED_VIEW}"]`,
  {
    timeout: 60_000,
  },
);
await page.waitForTimeout(2500);
const stacked = await sample();

// Fold through the face; then unfold through a real click on the header.
await page.evaluate(({ view }) => globalThis.__pracLayout.setViewCollapsed(view, true), {
  view: ADDED_VIEW,
});
await page.waitForTimeout(600);
const folded = await sample();

await page.click(`[data-prac-stack-toggle="${BASE_VIEW}"]`);
await page.waitForTimeout(600);
const clicked = await sample();

const entryOf = (facts, view) => facts.entries.find((entry) => entry.view === view) ?? null;
const bodyHeight = (facts, view) => entryOf(facts, view)?.body?.h ?? 0;

await browser.close();

const checks = {
  // 1. The default layout is untouched: one visible view, no headers.
  defaultIsBare: initial.entries.length === 0,
  // 2. Two visible views stack, in order, each with a header and a body.
  stackedHasBoth:
    stacked.entries.length === 2 &&
    entryOf(stacked, BASE_VIEW) !== null &&
    entryOf(stacked, ADDED_VIEW) !== null,
  // The two entries occupy different bands — which one sits on top is the
  // order's business, not this gate's.
  stackedDistinctBands:
    (entryOf(stacked, BASE_VIEW)?.entry?.y ?? 0) !==
      (entryOf(stacked, ADDED_VIEW)?.entry?.y ?? 0) &&
    (entryOf(stacked, BASE_VIEW)?.entry?.h ?? 0) > 0 &&
    (entryOf(stacked, ADDED_VIEW)?.entry?.h ?? 0) > 0,
  stackedBodies: bodyHeight(stacked, BASE_VIEW) > 40 && bodyHeight(stacked, ADDED_VIEW) > 40,
  stackedPainted: stacked.distinctColours > 4,
  // 3. Folding keeps the header, drops the body, and gives the space away.
  foldKeepsHeader:
    entryOf(folded, ADDED_VIEW)?.collapsed === true &&
    (entryOf(folded, ADDED_VIEW)?.header?.h ?? 0) > 0,
  foldDropsBody: bodyHeight(folded, ADDED_VIEW) <= 2,
  foldGrowsNeighbour: bodyHeight(folded, BASE_VIEW) > bodyHeight(stacked, BASE_VIEW),
  // 4. The header itself toggles (the UI path, not just the face).
  clickToggles:
    entryOf(clicked, BASE_VIEW)?.collapsed === true && bodyHeight(clicked, BASE_VIEW) <= 2,
  // Only this feature's own failures: the page carries known noise (missing
  // native bindings, two optional client modules) that every gate tolerates, so
  // matching on "prac" would match every path in the workspace.
  noErrors:
    consoleErrors.filter(
      (line) => line.includes("vscode-embed:") || line.includes("prac-client-ui-layout"),
    ).length === 0,
};

console.log(
  JSON.stringify(
    { url, region: REGION, initial, stacked, folded, clicked, checks, consoleErrors },
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
  "OK: one view renders bare, two stack with headers, folding keeps the header and hands the space over, and the header toggles on click.",
);
