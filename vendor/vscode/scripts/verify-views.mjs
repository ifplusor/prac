/**
 * Verify the recall surface: the frame's view catalogue driven **from the UI**.
 *
 * The mechanism (`prac-client-ui-layout`) can already place/hide/show/split/collapse any
 * view, but until this surface existed there was no entry point: the only move a
 * user had was switching attention. This script refuses to trust the DOM for
 * that claim, because a moved or recalled view is exactly where a DOM check lies
 * ("mounted, zero errors, blank"). So every state is judged on pixels:
 * screenshot the region/host clip, decode it in the page with `OffscreenCanvas`,
 * count distinct colours, and compare against the same clip with the owning
 * element hidden.
 *
 * What it drives and asserts:
 *
 *  1. `Cmd/Ctrl+Alt+V` opens and closes the overlay (present + painted), and
 *     `Escape` dismisses it;
 *  2. the catalogue the overlay lists is the mechanism's `listViews()` — the
 *     union of DSH slots (`dsh:sidebar`, every registered `main` key,
 *     `dsh:rightbar`) and the `prac.view` seat (`vscode:editor`), including views
 *     that are hidden;
 *  3. **hide** a view → its region collapses to 0 and the space goes to the
 *     regions that remain, which still paint;
 *  4. **recall** it → it returns to the region it was in, at the width it had
 *     (deliberately a dragged width, not the default), and it paints — the check
 *     that catches a stale size or a lost VS part;
 *  5. the keyboard path: arrow keys move the row cursor and `Enter` runs that
 *     row's 聚焦;
 *  6. **move** via 移到 → the view renders in the destination and paints while
 *     the source region's space is reclaimed;
 *  7. **分栏** → two regions side by side, both painted;
 *  8. **收起/展开** → a region goes to 0 (still present), the UI offers the
 *     inverse, the rest still paints, and expanding restores the width.
 *
 * Every action after the opening is taken through the overlay's own controls, so
 * what passes is the UI entry point, not the mechanism behind it.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' node scripts/verify-views.mjs
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
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3082/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** The overlay root and the controls this script drives, as the arrangement marks them. */
const RECALL = "[data-prac-recall]";
const ROW = "[data-prac-recall-row]";
const REGION_CONTROL = "[data-prac-recall-region]";
const toggleOf = (view) => `[data-prac-recall-toggle="${view}"]`;
const moveOf = (view) => `[data-prac-recall-move="${view}"]`;
const splitOf = (region) => `[data-prac-recall-split="${region}"]`;
const collapseOf = (region) => `[data-prac-recall-collapse="${region}"]`;
const EDITOR_VIEW = "vscode:editor";
const CONVERSATION_VIEW = "dsh:main:conversation";
// The DOM marks **part** ids, not view ids (see `PART_HOST_ATTR`) — the editor
// view is mounted as the editor part.
const EDITOR_PART = "workbench.parts.editor";
const EDITOR_HOST = `[data-vscode-embed-part-host="${EDITOR_PART}"]`;
const FRAME = "[data-prac-frame]";

/**
 * Decode a PNG inside the page and report how much of it is not one flat colour.
 *
 * Passed as a real function, not a string: Playwright serializes the function
 * source (a string that evaluates to a function comes back as `undefined`).
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
  return { distinctColours: counts.size, dominantShare: +(dominant / total).toFixed(4) };
};

/**
 * Paint evidence for one clip: distinct colours, and whether the same clip
 * changes when `hideSelector` is hidden (attribution to what is drawn there).
 *
 * @param page - the Playwright page.
 * @param area - `{x,y,w,h}` of the clip, or null.
 * @param hideSelector - the element(s) whose pixels the clip must depend on.
 */
async function paintAt(page, area, hideSelector) {
  if (!area || area.w < 2 || area.h < 2) return null;
  const clip = { x: area.x, y: area.y, width: area.w, height: area.h };
  const painted = await page.screenshot({ clip });
  await page.evaluate((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.style.visibility = "hidden";
    });
  }, hideSelector);
  const hidden = await page.screenshot({ clip });
  await page.evaluate((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.style.visibility = "";
    });
  }, hideSelector);
  return {
    ...(await page.evaluate(analyse, painted.toString("base64"))),
    differsWhenHidden: sha(painted) !== sha(hidden),
  };
}

/** Drag the sash matching `selector` by `dx` px. */
async function dragSash(page, selector, dx) {
  const point = await page.evaluate((sel) => {
    const sash = document.querySelector(sel);
    if (!sash) return null;
    const rect = sash.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  if (!point) throw new Error(`no sash matching "${selector}"`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(point.x + (dx * step) / 12, point.y, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Press the toggle keybinding and give the surface a beat to settle. */
async function toggleRecall(page) {
  await page.keyboard.press("Control+Alt+KeyV");
  await page.waitForTimeout(500);
}

/** Read the frame's DOM, the placement model, and the catalogue the overlay offers. */
async function sample(page) {
  const facts = await page.evaluate(
    ({ editorHost, rowSelector, regionControlSelector }) => {
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
      const host = document.querySelector(editorHost);
      const state = globalThis.__pracLayout.getState();
      const sizes = {};
      const walk = (node) => {
        if (node.type === "region") sizes[node.id] = { size: node.size, collapsed: node.collapsed };
        else node.children.forEach(walk);
      };
      walk(state.tree);
      return {
        frame: box(document.querySelector("[data-prac-frame]")),
        regions: [...document.querySelectorAll("[data-prac-region]")].map((element) => ({
          id: element.getAttribute("data-prac-region"),
          ...box(element),
        })),
        host: host
          ? {
              region: host.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
              box: box(host),
            }
          : null,
        hostCount: document.querySelectorAll(editorHost).length,
        // Where the conversation sits, from the layout probe: with the
        // conversation a view like any other it moves, so a gate that cares
        // about "the track stayed alive" has to read the placement, not infer it.
        conversationRegion:
          globalThis.__pracLayout?.getState?.().views?.["dsh:main:conversation"]?.region ?? null,
        overlay: box(document.querySelector("[data-prac-recall]")),
        strip: !!document.querySelector("[data-prac-focus-strip]"),
        rows: [...document.querySelectorAll(rowSelector)].map((element) => ({
          id: element.getAttribute("data-prac-recall-row"),
          where: element.querySelector("[data-prac-recall-where]")?.textContent?.trim() ?? null,
          hidden: element
            .querySelector("[data-prac-recall-where]")
            ?.getAttribute("data-prac-recall-hidden"),
        })),
        regionControls: [...document.querySelectorAll(regionControlSelector)].map((element) =>
          element.getAttribute("data-prac-recall-region"),
        ),
        regionCollapseStates: Object.fromEntries(
          [...document.querySelectorAll("[data-prac-recall-collapse]")].map((element) => [
            element.getAttribute("data-prac-recall-collapse"),
            element.getAttribute("data-prac-recall-collapsed"),
          ]),
        ),
        selectedRow:
          document
            .querySelector("[data-prac-recall-selected]")
            ?.getAttribute("data-prac-recall-row") ?? null,
        catalogue: globalThis.__pracLayout.listViews(),
        regionInfos: globalThis.__pracLayout.listRegions(),
        catalogueVersion: state.catalogueVersion,
        modelSizes: sizes,
        modelViews: state.views,
      };
    },
    {
      editorHost: EDITOR_HOST,
      rowSelector: ROW,
      regionControlSelector: REGION_CONTROL,
    },
  );

  const regionOf = (id) => facts.regions.find((region) => region.id === id) ?? null;
  facts.left = regionOf("left");
  facts.right = regionOf("right");
  facts.console = regionOf("stage");
  facts.editorPaint = await paintAt(page, facts.host?.box, EDITOR_HOST);
  facts.overlayPaint = facts.overlay ? await paintAt(page, facts.overlay, RECALL) : null;
  return facts;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector(FRAME, { timeout: 60_000 });
await page.waitForSelector(EDITOR_HOST, { timeout: 60_000 });
// Give Monaco a beat to paint after the grid lays it out.
await page.waitForTimeout(3000);

const probeReady = await page.evaluate(
  () =>
    typeof globalThis.__pracLayout?.listViews === "function" &&
    typeof globalThis.__pracLayout?.listRegions === "function" &&
    typeof globalThis.__pracLayout?.place === "function" &&
    typeof globalThis.__pracLayout?.hide === "function" &&
    typeof globalThis.__pracLayout?.show === "function" &&
    typeof globalThis.__pracLayout?.split === "function",
);
if (!probeReady) throw new Error("globalThis.__pracLayout is missing the catalogue/placement face");

const states = {};
states.default = await sample(page);

// ── 1. the keybinding opens and closes the surface ───────────────────────────
await toggleRecall(page);
states.opened = await sample(page);

// The same keybinding closes it again (a toggle, not an open-only key).
await toggleRecall(page);
states.closedByKey = await sample(page);

// And Escape dismisses it.
await toggleRecall(page);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
states.dismissed = await sample(page);

// ── 2. give `right` a distinctive width, so a recall must restore *this* ────
await dragSash(page, '[data-prac-sash-right="right"]', 100);
states.dragged = await sample(page);
const dragWidth = states.dragged.right?.w ?? 0;

// ── 3. hide via the overlay's own button ─────────────────────────────────────
await toggleRecall(page);
await page.click(toggleOf(EDITOR_VIEW));
await page.waitForTimeout(800);
states.hiddenWhileOpen = await sample(page);
await toggleRecall(page);
states.hidden = await sample(page);
states.hiddenConsolePaint = await paintAt(
  page,
  states.hidden.console,
  '[data-prac-region="stage"] > *',
);

// ── 4. recall via the same button ────────────────────────────────────────────
await toggleRecall(page);
await page.click(toggleOf(EDITOR_VIEW));
await page.waitForTimeout(800);
states.recalledWhileOpen = await sample(page);
await toggleRecall(page);
states.recalled = await sample(page);

// ── 5. the keyboard path: arrow keys move the cursor, Enter runs 聚焦 ────────
// The cursor is read with a DOM-only probe: sampling (which hides the overlay to
// attribute its pixels) would blur the focused panel before `Enter` is pressed.
await toggleRecall(page);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const selectedRow = await page.evaluate(
  () =>
    document.querySelector("[data-prac-recall-selected]")?.getAttribute("data-prac-recall-row") ??
    null,
);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
await toggleRecall(page);
states.cursorMoved = selectedRow;
states.focusedByKey = await sample(page);

// ── 6. move via 移到 (the select) ────────────────────────────────────────────
await toggleRecall(page);
await page.selectOption(moveOf(EDITOR_VIEW), "right");
await page.waitForTimeout(800);
await toggleRecall(page);
states.movedBySelect = await sample(page);

// ── 7. 分栏 + 移到: two panes side by side, each painted ────────────────────
await toggleRecall(page);
await page.click(splitOf("stage"));
await page.waitForTimeout(800);
const newRegion = await page.evaluate(() => {
  const ids = [...document.querySelectorAll("[data-prac-region]")].map((element) =>
    element.getAttribute("data-prac-region"),
  );
  return ids.find((id) => !["left", "stage", "right"].includes(id)) ?? null;
});
if (!newRegion) throw new Error("分栏 did not create a new region");
await page.selectOption(moveOf(EDITOR_VIEW), "stage");
await page.selectOption(moveOf(CONVERSATION_VIEW), newRegion);
await page.waitForTimeout(800);
states.splitWhileOpen = await sample(page);
await toggleRecall(page);
states.split = await sample(page);
const newPane = states.split.regions.find((region) => region.id === newRegion) ?? null;
states.splitNewPane = newRegion;
states.newPanePaint = await paintAt(page, newPane, `[data-prac-region="${newRegion}"] > *`);

// ── 8. 收起 / 展开 a region from the UI ─────────────────────────────────────
await toggleRecall(page);
await page.click(collapseOf("left"));
await page.waitForTimeout(800);
states.regionCollapsedOpen = await sample(page);
await toggleRecall(page);
states.regionCollapsed = await sample(page);
states.regionCollapsedPaint = await paintAt(
  page,
  states.regionCollapsed.console,
  '[data-prac-region="stage"] > *',
);
await toggleRecall(page);
await page.click(collapseOf("left"));
await page.waitForTimeout(800);
await toggleRecall(page);
states.regionExpanded = await sample(page);

await page.screenshot({ path: resolve(repoRoot, ".build/views.png") });
await browser.close();

// ── verdicts ─────────────────────────────────────────────────────────────────

/** The paint evidence every must-show state needs: content, attributed to the clip. */
const painted = (evidence) =>
  !!evidence &&
  evidence.distinctColours > 4 &&
  evidence.dominantShare < 0.98 &&
  evidence.differsWhenHidden === true;
const paneIds = (state) => state.regions.map((region) => region.id).join(",");
const sideBySide = (left, right) =>
  !!left && !!right && left.y === right.y && left.x < right.x && left.h === right.h;

const catalogueIds = (state) => state.catalogue.map((view) => view.id);
const rowIds = (state) => state.rows.map((row) => row.id);
const regionControlIds = (state) => state.regionControls;
const regionInfoIds = (state) => state.regionInfos.map((region) => region.id);

const gutter = 5; // the sash between two regions, in px (prac-client-ui-layout's SASH_SIZE)

const checks = {
  // 1. the keybinding toggles, the surface is painted, Escape dismisses it.
  keyOpens: !states.default.overlay && !!states.opened.overlay,
  overlayPainted: painted(states.opened.overlayPaint),
  keyCloses: !!states.opened.overlay && !states.closedByKey.overlay,
  escapeDismisses: !!states.opened.overlay && !states.dismissed.overlay,
  // The attention strip the recall surface sits beside is untouched.
  stripStillPresent: states.default.strip && states.opened.strip && states.split.strip,

  // 2. the offered catalogue is the mechanism's union, re-read live.
  catalogueListsDshSlots:
    catalogueIds(states.opened).includes("dsh:sidebar") &&
    catalogueIds(states.opened).includes("dsh:main:conversation") &&
    catalogueIds(states.opened).includes("dsh:rightbar"),
  catalogueListsSeatView: catalogueIds(states.opened).includes(EDITOR_VIEW),
  catalogueVersionMoves: states.opened.catalogueVersion > 0,
  rowsMatchCatalogue: rowIds(states.opened).join(",") === catalogueIds(states.opened).join(","),
  regionsMatchCatalogue:
    regionControlIds(states.opened).join(",") === regionInfoIds(states.opened).join(","),
  hiddenViewOffered: states.opened.rows.find((row) => row.id === "dsh:rightbar")?.hidden === "true",

  // 3. hide: `right` collapses to nothing and its space is taken by `console`.
  hideCollapsedRight: states.hidden.right === null && states.hidden.hostCount === 0,
  hideGaveSpaceToConsole: states.hidden.console.w === states.dragged.console.w + dragWidth + gutter,
  hideOffersShow:
    states.hiddenWhileOpen.rows.find((row) => row.id === EDITOR_VIEW)?.hidden === "true",
  remainingViewPainted: painted(states.hiddenConsolePaint),

  // 4. recall: back in `right`, at the dragged width, and painting.
  recallReturnedToRight: states.recalled.host?.region === "right",
  recallRestoredWidth:
    states.recalled.right?.w === dragWidth && states.recalled.modelSizes.right?.size === dragWidth,
  recallConsoleShrankBack: states.recalled.console.w === states.dragged.console.w,
  recallPainted: painted(states.recalled.editorPaint),

  // 5. arrow keys move the cursor; Enter runs the selected row's 聚焦.
  arrowsMoveCursor: states.cursorMoved === EDITOR_VIEW,
  enterFocusedIntoConsole:
    states.focusedByKey.host?.region === "stage" &&
    // The conversation parks in the track instead of the track emptying out:
    // one view holds a region, and the one that yields stays on screen.
    states.focusedByKey.conversationRegion === "right",
  enterFocusPainted: painted(states.focusedByKey.editorPaint),

  // 6. 移到: the view renders in the destination, and the source region's space
  // is reclaimed (console returns to the width it had before the move out).
  selectMoveLanded: states.movedBySelect.host?.region === "right",
  selectMoveRestoredWidth: states.movedBySelect.right?.w === dragWidth,
  selectMoveSourceReclaimed: states.movedBySelect.console.w === states.dragged.console.w,
  selectMovePainted: painted(states.movedBySelect.editorPaint),

  // 7. 分栏: two panes side by side, both painted.
  splitTwoPanes:
    !!newPane &&
    states.split.regions.length === 3 &&
    paneIds(states.split) === `left,stage,${newRegion}`,
  splitPanesSideBySide: sideBySide(states.split.console, newPane),
  splitEditorPainted: painted(states.split.editorPaint) && states.split.host?.region === "stage",
  splitConversationPanePainted: painted(states.newPanePaint),

  // 8. 收起 / 展开 a region: the region goes to 0 (still present), the UI offers
  // 展开, the rest still paints, and expanding restores the width it had.
  regionCollapseFromUi:
    states.regionCollapsed.left?.w === 0 &&
    states.regionCollapsed.modelSizes.left?.collapsed === true &&
    states.regionCollapsedOpen.regionCollapseStates.left === "true",
  regionCollapseStillPaints: painted(states.regionCollapsedPaint),
  regionExpandFromUi:
    states.regionExpanded.left?.w === 280 &&
    states.regionExpanded.modelSizes.left?.collapsed === false,
};

const report = {
  url,
  checks,
  evidence: {
    editorView: EDITOR_VIEW,
    dragWidth,
    hidden: {
      regions: paneIds(states.hidden),
      console: states.hidden.console?.w,
      draggedConsole: states.dragged.console?.w,
    },
    recall: {
      region: states.recalled.host?.region,
      width: states.recalled.right?.w,
      modelSize: states.recalled.modelSizes.right?.size,
      console: states.recalled.console?.w,
    },
    keyboard: { selected: states.cursorMoved },
    catalogue: {
      ids: catalogueIds(states.opened),
      version: states.opened.catalogueVersion,
      regions: regionInfoIds(states.opened),
      rows: states.opened.rows,
    },
    split: {
      newRegion,
      regions: states.split.regions,
    },
    collapse: {
      collapsedWidth: states.regionCollapsed.left?.w,
      collapsedModel: states.regionCollapsed.modelSizes.left?.collapsed,
      expandedWidth: states.regionExpanded.left?.w,
    },
  },
  states,
  errorCount: errors.length,
  errors: errors.slice(0, 6),
};

console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length) {
  console.error(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "\nOK: the recall surface opens on a key, offers the live view catalogue, and hide/recall/move/split all take effect in pixels.",
);
