/**
 * Verification of **splitting** (decision 20, and decision 15's "分栏必带视图")
 * — the half of it a live page owns.
 *
 * The verb is view-centric: `splitView(viewId, side)` moves a view into a region
 * the mechanism creates for it on that side. The *tree* that produces — axes,
 * child order, flexibility, nesting, one new region per call — is a unit test
 * (`ui-layout`'s `model.spec.ts`), so this gate spends its browser on:
 *
 *  1. **the pane lands where the side says** — right of the source for `right`,
 *     left for `left`, below for `down`, sharing the band or the width (the
 *     arithmetic mirror and real CSS agreeing);
 *  2. **the split carries a view** — the moved view is in the new pane and paints
 *     there, while the region it left keeps the view it shared with;
 *  3. **both axes drag** — a real mouse drag on the vertical sash resizes the
 *     pair, not just the horizontal one;
 *  4. **the shape survives a reload** — placements and the dragged size.
 *
 * Both opposing sides (`right` *and* `left`) are exercised on purpose: the two
 * orderings reach different DOM layouts, and verifying one direction only is the
 * same trap as a sash gate that only ever drags one way.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' pnpm verify:split
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

const LEFT = "left";
const STAGE = "stage";
const CONVERSATION = "dsh:main:conversation";
const DSH_SIDEBAR = "dsh:sidebar";
const VSCODE_SIDEBAR = "vscode:sidebar";
/** The key `prac-client-ui-layout` persists under (see its `store.ts`). */
const STATE_KEY = "prac-layout/v1";
/** How far the vertical sash is dragged, in px. */
const DRAG = 100;

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);

/** Wait for the frame to be rendered after a navigation. */
async function settle() {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__pracLayout, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

/**
 * Read the frame's DOM and its model: region boxes, the split tree's axes and
 * children, each view's placement, and each region's size.
 *
 * @returns {Promise<object>} the sample.
 */
async function sample() {
  return page.evaluate(() => {
    const box = (element) => {
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    const state = globalThis.__pracLayout.getState();
    const splits = [];
    const sizes = {};
    const walk = (node) => {
      if (node.type === "region") {
        sizes[node.id] = { size: node.size, flex: node.flex, collapsed: node.collapsed };
        return;
      }
      splits.push({ id: node.id, dir: node.dir, children: node.children.map((child) => child.id) });
      node.children.forEach(walk);
    };
    walk(state.tree);
    return {
      regions: [...document.querySelectorAll("[data-prac-region]")].map((element) => ({
        id: element.getAttribute("data-prac-region"),
        box: box(element),
        children: element.children.length,
      })),
      splitDirs: [...document.querySelectorAll("[data-prac-split]")].map((element) =>
        element.getAttribute("data-prac-split-dir"),
      ),
      sashDirs: [...document.querySelectorAll("[data-prac-sash]")].map((element) =>
        element.getAttribute("data-prac-sash-dir"),
      ),
      splits,
      sizes,
      views: Object.fromEntries(
        Object.entries(state.views).map(([id, view]) => [
          id,
          { region: view.region, hidden: view.hidden },
        ]),
      ),
    };
  });
}

/** Drag the first sash matching `selector`, by `{ dx, dy }`. */
async function dragSash(selector, { dx = 0, dy = 0 }) {
  const point = await page.evaluate((query) => {
    const sash = document.querySelector(query);
    if (sash === null) return null;
    const rect = sash.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (point === null) throw new Error(`no sash matching "${selector}"`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(point.x + (dx * step) / 12, point.y + (dy * step) / 12, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** The region box for `id`, or null when the region is not rendered. */
const regionBox = (facts, id) => facts.regions.find((region) => region.id === id)?.box ?? null;
/** Every region id `after` has that `before` did not. */
const freshIds = (before, after) => {
  const known = new Set(before.regions.map((region) => region.id));
  return after.regions.filter((region) => !known.has(region.id)).map((region) => region.id);
};
/** The region a view is placed in, per the model. */
const paneOf = (facts, view) => facts.views[view]?.region ?? null;
const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;

// A fresh origin: the arrangement's defaults, not a previous run's leftovers.
await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await settle();
const initial = await sample();

// 1. Split the conversation out to the right of the stage.
await page.evaluate((view) => globalThis.__pracLayout.splitView(view, "right"), CONVERSATION);
await page.waitForTimeout(1200);
const splitRight = await sample();
const rightPane = paneOf(splitRight, CONVERSATION);
splitRight.panePaint =
  regionBox(splitRight, rightPane) === null
    ? 0
    : await distinctColours(page, regionBox(splitRight, rightPane));

// 2. Split the same view back out to the *left*: the other half of the ordering
//    rule (the new region goes before the source, not after it).
await page.evaluate((view) => globalThis.__pracLayout.splitView(view, "left"), CONVERSATION);
await page.waitForTimeout(1200);
const splitLeft = await sample();
const leftPane = paneOf(splitLeft, CONVERSATION);
splitLeft.panePaint =
  regionBox(splitLeft, leftPane) === null
    ? 0
    : await distinctColours(page, regionBox(splitLeft, leftPane));

// 3. Split the (now shown) sidebar view downward: a nested column split.
await page.evaluate((view) => globalThis.__pracLayout.show(view), VSCODE_SIDEBAR);
await page.waitForTimeout(900);
await page.evaluate((view) => globalThis.__pracLayout.splitView(view, "down"), VSCODE_SIDEBAR);
await page.waitForTimeout(1200);
const nested = await sample();
const belowPane = paneOf(nested, VSCODE_SIDEBAR);
nested.panePaint =
  regionBox(nested, belowPane) === null
    ? 0
    : await distinctColours(page, regionBox(nested, belowPane));

// 4. Drag the vertical sash: the column axis resizes like the row axis does.
const beforeDrag = nested.sizes[LEFT]?.size ?? 0;
await dragSash('[data-prac-sash-dir="column"]', { dy: DRAG });
const dragged = await sample();

// 5. Reload: the shape (and the size) comes back.
await page.reload({ waitUntil: "load" });
await settle();
const restored = await sample();

await close();

// ── the assertions ───────────────────────────────────────────────────────────
//
// Decision 21 draws the line here: **what the tree should look like** is a unit
// test (`ui-layout`'s `model.spec.ts` covers `sideGeometry`, `splitRegionWith`'s
// child order and flexibility, nesting, one-new-region-per-call, and the sash
// arithmetic). What is left for a live page is what only a live page can show:
// the panes land on the side they were asked for in real CSS, the view lands in
// the pane that was made for it and paints, a real mouse drag moves the vertical
// boundary, and the shape survives a reload.
const checks = {
  // The premise: a fresh origin really is the factory arrangement.
  startedDefault: initial.regions.map((region) => region.id).join(",") === "left,stage",
  // Each side's pane renders where the side says, and holds the view.
  paneOnTheRight:
    (regionBox(splitRight, rightPane)?.x ?? 0) > (regionBox(splitRight, STAGE)?.x ?? 0) &&
    near(regionBox(splitRight, rightPane)?.y, regionBox(splitRight, STAGE)?.y, 2) &&
    near(regionBox(splitRight, rightPane)?.h, regionBox(splitRight, STAGE)?.h, 2),
  paneOnTheLeft:
    (regionBox(splitLeft, leftPane)?.x ?? 0) < (regionBox(splitLeft, rightPane)?.x ?? 0) &&
    near(regionBox(splitLeft, leftPane)?.y, regionBox(splitLeft, rightPane)?.y, 2),
  paneBelow:
    (regionBox(nested, belowPane)?.y ?? 0) > (regionBox(nested, LEFT)?.y ?? 0) &&
    near(regionBox(nested, belowPane)?.x, regionBox(nested, LEFT)?.x, 2) &&
    near(regionBox(nested, belowPane)?.w, regionBox(nested, LEFT)?.w, 2),
  viewInThePane:
    paneOf(splitRight, CONVERSATION) === rightPane &&
    paneOf(splitLeft, CONVERSATION) === leftPane &&
    paneOf(nested, VSCODE_SIDEBAR) === belowPane,
  // The renderer follows the model: the moved view actually paints there.
  panesPainted: splitRight.panePaint > 4 && splitLeft.panePaint > 4 && nested.panePaint > 4,
  // The pane the view left keeps the view it was sharing the region with.
  sourceKeptItsView: paneOf(nested, DSH_SIDEBAR) === LEFT,
  // The other axis: a vertical boundary exists and a real drag resizes the pair.
  columnSashDrags:
    nested.sashDirs.includes("column") &&
    near(dragged.sizes[LEFT]?.size, beforeDrag + DRAG, 8) &&
    (regionBox(dragged, belowPane)?.h ?? 0) < (regionBox(nested, belowPane)?.h ?? 0) - DRAG / 2 &&
    near(regionBox(dragged, belowPane)?.w, regionBox(nested, belowPane)?.w, 2),
  // The whole shape — placements and the dragged size — survives a reload.
  placementsRestored:
    paneOf(restored, CONVERSATION) === paneOf(dragged, CONVERSATION) &&
    paneOf(restored, VSCODE_SIDEBAR) === paneOf(dragged, VSCODE_SIDEBAR) &&
    paneOf(restored, DSH_SIDEBAR) === paneOf(dragged, DSH_SIDEBAR),
  geometryRestored:
    near(restored.sizes[LEFT]?.size, dragged.sizes[LEFT]?.size, 2) &&
    near(regionBox(restored, belowPane)?.h, regionBox(dragged, belowPane)?.h, 6) &&
    near(
      regionBox(restored, paneOf(dragged, CONVERSATION))?.w,
      regionBox(dragged, paneOf(dragged, CONVERSATION))?.w,
      6,
    ),
  // Only this feature's own failures; the page's known noise is not ours.
  noErrors:
    own("__pracLayout").length === 0 &&
    own("prac-client-ui-layout").length === 0 &&
    own("vscode-embed:").length === 0,
};

report({
  url,
  facts: {
    initial,
    splitRight,
    splitLeft,
    nested,
    dragged,
    restored,
    freshIds: {
      right: freshIds(initial, splitRight),
      left: freshIds(splitRight, splitLeft),
      below: freshIds(splitLeft, nested),
    },
    consoleErrors,
  },
  checks,
  ok: "OK: a view splits out to the side it asks for (row or column, nested, either order), the pane it leaves keeps its own view, the vertical sash drags, and the whole shape survives a reload.",
});
