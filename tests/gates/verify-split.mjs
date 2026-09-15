/**
 * Verification of **splitting** (decision 20, and decision 15's "分栏必带视图").
 *
 * The verb is view-centric: `splitView(viewId, side)` moves a view into a region
 * the mechanism creates for it on that side. So this gate asserts the two halves
 * of that sentence:
 *
 *  1. **the pane appears where the side says** — a new region beside the source,
 *     on the right for `right`, on the left for `left`, below for `down`; a `row`
 *     split or a `column` split accordingly, nesting freely;
 *  2. **the split carries a view and is not a rearrangement** — the split view
 *     renders in the new pane (painted), the region it came from keeps the view
 *     it was sharing that region with, and each split adds exactly one pane (the
 *     one holding the view), so no direction leaves empty chrome behind;
 *  3. **both axes are draggable** — a real mouse drag on the vertical sash
 *     resizes the pair, not just the horizontal one;
 *  4. **the shape survives a reload** — including the dragged size, which is the
 *     tree shape decision 16 persists.
 *
 * Both opposing sides are exercised on purpose (`right` *and* `left`): the side
 * decides the child order inside the new split, so testing one direction only
 * would leave the other branch unverified — the same trap as the sash gate that
 * only ever dragged one way.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' pnpm verify:split
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

const LEFT = "left";
const STAGE = "stage";
const RIGHT = "right";
const CONVERSATION = "dsh:main:conversation";
const DSH_SIDEBAR = "dsh:sidebar";
const VSCODE_SIDEBAR = "vscode:sidebar";
/** The three regions the frame ships with; anything else is one this gate made. */
const SHIPPED = [LEFT, STAGE, RIGHT];
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
/** The split whose children include `regionId`. */
const splitOf = (facts, regionId) =>
  facts.splits.find((split) => split.children.includes(regionId)) ?? null;
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

const checks = {
  // 1. The pane appears where the side says, and the view is in it.
  startedDefault: initial.regions.map((region) => region.id).join(",") === "left,stage,right",
  rightSplitIsARow: splitOf(splitRight, rightPane)?.dir === "row",
  rightSplitPutsPaneAfter:
    splitOf(splitRight, rightPane)?.children.join(",") === `${STAGE},${rightPane}` &&
    (regionBox(splitRight, rightPane)?.x ?? 0) > (regionBox(splitRight, STAGE)?.x ?? 0),
  rightPaneSpansTheRow:
    near(regionBox(splitRight, rightPane)?.y, regionBox(splitRight, STAGE)?.y, 2) &&
    near(regionBox(splitRight, rightPane)?.h, regionBox(splitRight, STAGE)?.h, 2),
  viewMovedIntoPane: paneOf(splitRight, CONVERSATION) === rightPane,
  panePainted: splitRight.panePaint > 4,
  stageKeptAsEmptyWorkArea:
    regionBox(splitRight, STAGE) !== null &&
    (splitRight.regions.find((region) => region.id === STAGE)?.children ?? 1) === 0,
  // 2. The opposite side: the new region is inserted *before* the source.
  leftSplitPutsPaneFirst:
    splitOf(splitLeft, leftPane)?.children.join(",") === `${leftPane},${rightPane}` &&
    (regionBox(splitLeft, leftPane)?.x ?? 0) < (regionBox(splitLeft, rightPane)?.x ?? 0),
  leftPaneAlignedWithSource:
    near(regionBox(splitLeft, leftPane)?.y, regionBox(splitLeft, rightPane)?.y, 2) &&
    near(regionBox(splitLeft, leftPane)?.h, regionBox(splitLeft, rightPane)?.h, 2),
  leftPanePainted: splitLeft.panePaint > 4,
  // 3. A column split nested in the row: below, same width, stack's other view put.
  downSplitIsAColumn: splitOf(nested, belowPane)?.dir === "column",
  downSplitPutsPaneBelow:
    (regionBox(nested, belowPane)?.y ?? 0) > (regionBox(nested, LEFT)?.y ?? 0),
  paneAlignedWithSource:
    near(regionBox(nested, belowPane)?.x, regionBox(nested, LEFT)?.x, 2) &&
    near(regionBox(nested, belowPane)?.w, regionBox(nested, LEFT)?.w, 2),
  nestedViewMoved: paneOf(nested, VSCODE_SIDEBAR) === belowPane,
  sourceKeptItsView: paneOf(nested, DSH_SIDEBAR) === LEFT,
  columnSashRendered: nested.sashDirs.includes("column") && nested.splitDirs.includes("column"),
  // Each split made exactly one new region, and it is the one holding the view
  // (checked above) — so a split never leaves an extra empty pane behind.
  oneNewPanePerSplit:
    freshIds(initial, splitRight).length === 1 &&
    freshIds(splitRight, splitLeft).length === 1 &&
    freshIds(splitLeft, nested).length === 1,
  // 4. A real drag on the vertical sash resizes the pair.
  dragGrewUpper: near(dragged.sizes[LEFT]?.size, beforeDrag + DRAG, 8),
  dragShrankLower:
    (regionBox(dragged, belowPane)?.h ?? 0) < (regionBox(nested, belowPane)?.h ?? 0) - DRAG / 2,
  dragKeptWidth: near(regionBox(dragged, belowPane)?.w, regionBox(nested, belowPane)?.w, 2),
  // 5. The whole shape survives a reload, dragged size included.
  regionsRestored:
    restored.regions.map((region) => region.id).join(",") ===
    dragged.regions.map((region) => region.id).join(","),
  placementsRestored:
    paneOf(restored, CONVERSATION) === paneOf(dragged, CONVERSATION) &&
    paneOf(restored, VSCODE_SIDEBAR) === paneOf(dragged, VSCODE_SIDEBAR) &&
    paneOf(restored, DSH_SIDEBAR) === paneOf(dragged, DSH_SIDEBAR),
  sizeRestored: near(restored.sizes[LEFT]?.size, dragged.sizes[LEFT]?.size, 2),
  geometryRestored:
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
