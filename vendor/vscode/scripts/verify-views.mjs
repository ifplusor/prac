/**
 * Verify the recall surface: the frame's view catalogue driven **from the UI**.
 *
 * The mechanism (`prac-client-ui-frame`) can already place/hide/show/split/collapse any
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
 *  2. the catalogue the overlay lists is the mechanism's `listItems()` — the
 *     union of DSH slots (`dsh:sidebar`, every registered `main` key,
 *     `dsh:rightbar`) and the content seats (one `vscode:file:<resource>` per
 *     open file), including views that are hidden;
 *  3. **移到** frees the track: the conversation leaves `right` for `left`, and
 *     the current file view then moves into `right` as its only occupant;
 *  4. **hide** a view → its fixed region collapses to 0 and the space goes to the
 *     flexible regions that remain, which still paint;
 *  5. **recall** it → it returns to the region it was in, at the width it had
 *     (deliberately a dragged width, not the default), and it paints — the check
 *     that catches a stale size or a lost editing surface;
 *  6. the keyboard path: arrow keys move the row cursor and `Enter` runs that
 *     row's 聚焦, which centres the file and parks the conversation in the track;
 *  7. **移到** again → the file renders in the destination and the source
 *     region's space is reclaimed;
 *  8. **分栏** → two regions side by side, the source keeps the view it shared,
 *     and both paint;
 *  9. **收起/展开** → a region goes to 0 (still present), the UI offers the
 *     inverse, the rest still paints, and expanding restores the width.
 *
 * Every action after the opening is taken through the overlay's own controls, so
 * what passes is the UI entry point, not the mechanism behind it.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-views.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const upstreamDir = process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode");
const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
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
const splitOf = (view, side) => `[data-prac-recall-split="${view}:${side}"]`;
const collapseOf = (region) => `[data-prac-recall-collapse="${region}"]`;
/** The view id a file view carries by convention (`prac-client-vscode-host`). */
const FILE_VIEW_PREFIX = "vscode:file:";
const CONVERSATION_VIEW = "dsh:main:conversation";
// Since decision 17 the editor is one view per open file: the host is the file
// host, and which resource it holds is discovered live.
const EDITOR_HOST = "[data-vscode-embed-file]";
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
  await page.evaluate((selector) => globalThis.__deep.hide(selector, true), hideSelector);
  const hidden = await page.screenshot({ clip });
  await page.evaluate((selector) => globalThis.__deep.hide(selector, false), hideSelector);
  return {
    ...(await page.evaluate(analyse, painted.toString("base64"))),
    differsWhenHidden: sha(painted) !== sha(hidden),
  };
}

/** Drag the sash matching `selector` by `dx` px. */
async function dragSash(page, selector, dx) {
  const point = await page.evaluate((sel) => {
    const sash = globalThis.__deep.one(sel);
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

/** Move a view to a region through the overlay's own 移到 select. */
async function moveViaOverlay(page, view, region) {
  await toggleRecall(page);
  await page.selectOption(moveOf(view), region);
  await page.waitForTimeout(800);
  await toggleRecall(page);
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
      const host = globalThis.__deep.one(editorHost);
      const state = globalThis.__pracFrame.getState();
      const sizes = {};
      const walk = (node) => {
        if (node.type === "region") sizes[node.id] = { size: node.size, collapsed: node.collapsed };
        else node.children.forEach(walk);
      };
      walk(state.tree);
      return {
        frame: box(globalThis.__deep.one("[data-prac-frame]")),
        // A region that holds two visible views is a `column` split carrying the same id, so the
        // list of "regions on screen" has to count both kinds — otherwise a track that became a
        // stack looks like it vanished and the pane a split just added cannot be told apart.
        regions: [...globalThis.__deep.all("[data-prac-region], [data-prac-split]")].map(
          (element) => ({
            id: element.getAttribute("data-prac-region") ?? element.getAttribute("data-prac-split"),
            split: element.hasAttribute("data-prac-split"),
            ...box(element),
          }),
        ),
        host: host
          ? {
              // A view may sit in a stack **row**: the row's id is the region's id plus the view, so
              // the region a person means is the part before `/stack/`.
              region: (() => {
                const id =
                  globalThis.__deep
                    .closest(host, "[data-prac-region]")
                    ?.getAttribute("data-prac-region") ?? null;
                return id === null ? null : id.split("/stack/")[0];
              })(),
              box: box(host),
            }
          : null,
        hostCount: globalThis.__deep.all(editorHost).length,
        // Where the conversation sits, from the layout probe: with the
        // conversation a view like any other it moves, so a gate that cares
        // about "the track stayed alive" has to read the placement, not infer it.
        conversationRegion:
          globalThis.__pracFrame?.getState?.().items?.["dsh:main:conversation"]?.region ?? null,
        overlay: box(globalThis.__deep.one("[data-prac-recall]")),
        strip: !!globalThis.__deep.one("[data-prac-focus-strip]"),
        rows: [...globalThis.__deep.all(rowSelector)].map((element) => ({
          id: element.getAttribute("data-prac-recall-row"),
          where: element.querySelector("[data-prac-recall-where]")?.textContent?.trim() ?? null,
          hidden: element
            .querySelector("[data-prac-recall-where]")
            ?.getAttribute("data-prac-recall-hidden"),
        })),
        regionControls: [...globalThis.__deep.all(regionControlSelector)].map((element) =>
          element.getAttribute("data-prac-recall-region"),
        ),
        regionCollapseStates: Object.fromEntries(
          [...globalThis.__deep.all("[data-prac-recall-collapse]")].map((element) => [
            element.getAttribute("data-prac-recall-collapse"),
            element.getAttribute("data-prac-recall-collapsed"),
          ]),
        ),
        selectedRow:
          document
            .querySelector("[data-prac-recall-selected]")
            ?.getAttribute("data-prac-recall-row") ?? null,
        catalogue: globalThis.__pracFrame.listItems(),
        regionInfos: globalThis.__pracFrame.listRegions(),
        catalogueVersion: state.catalogueVersion,
        modelSizes: sizes,
        modelViews: state.items,
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
  facts.stage = regionOf("center");
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
if ((await page.locator("[data-prac-firstrun]").count()) > 0) {
  const rows = page.locator(".prac-firstrun-row");
  if ((await rows.count()) > 0) {
    await rows.first().click();
  } else {
    const input = page.locator(".prac-firstrun-input");
    if ((await input.count()) > 0) {
      await input.fill(process.cwd());
      await page.locator(".prac-firstrun-button").click();
    }
  }
}
await page.waitForSelector(FRAME, { timeout: 60_000 });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });

// Open one file: without one there is no editor view to list or drive.
// The gate's own file, opened by URI: the app's folder is DSH's last-used workspace,
// which is not this repository (see `gate-fixtures.mjs`).
const [PROBE] = writeFixtures("views", url, [
  {
    name: "probe.txt",
    body: (token) =>
      `the views probe ${token}\nsecond line\nthird line\nfourth line\nfifth line\nsixth line\nseventh line\neighth line\n`,
  },
]);
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), PROBE.uri);
await waitDeep(page, `${EDITOR_HOST} .monaco-editor`);
// Give Monaco a beat to paint after the grid lays it out.
await page.waitForTimeout(3000);

const probeReady = await page.evaluate(
  () =>
    typeof globalThis.__pracFrame?.listItems === "function" &&
    typeof globalThis.__pracFrame?.listRegions === "function" &&
    typeof globalThis.__pracFrame?.place === "function" &&
    typeof globalThis.__pracFrame?.hide === "function" &&
    typeof globalThis.__pracFrame?.show === "function" &&
    typeof globalThis.__pracFrame?.splitItem === "function",
);
if (!probeReady) throw new Error("globalThis.__pracFrame is missing the catalogue/placement face");

const FILE_VIEW = await page.evaluate(
  (prefix) =>
    globalThis.__pracFrame
      .listItems()
      .map((view) => view.id)
      .find((id) => id.startsWith(prefix)) ?? null,
  FILE_VIEW_PREFIX,
);
if (!FILE_VIEW) throw new Error("no file view was declared after opening a file");

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

// ── 2. 移到 frees the track: the conversation leaves `right` for `left` ──────
// The file view is the only editor surface, and the track must hold it alone for
// hiding it to collapse the region. The conversation is what fills `right` by
// default, so moving it out is the move the UI already offers.
await moveViaOverlay(page, CONVERSATION_VIEW, "left");
states.conversationMoved = await sample(page);

// …and the file takes the track it just freed.
await moveViaOverlay(page, FILE_VIEW, "right");
states.fileInTrack = await sample(page);

// ── 3. give `right` a distinctive width, so a recall must restore *this* ────
await dragSash(page, '[data-prac-sash-right="right"]', 100);
states.dragged = await sample(page);
const dragWidth = states.dragged.right?.w ?? 0;

// ── 4. hide via the overlay's own button ─────────────────────────────────────
await toggleRecall(page);
await page.click(toggleOf(FILE_VIEW));
await page.waitForTimeout(800);
states.hiddenWhileOpen = await sample(page);
await toggleRecall(page);
states.hidden = await sample(page);
states.hiddenRestPaint = await paintAt(page, states.hidden.left, '[data-prac-region="left"] > *');

// ── 5. recall via the same button ────────────────────────────────────────────
await toggleRecall(page);
await page.click(toggleOf(FILE_VIEW));
await page.waitForTimeout(800);
states.recalledWhileOpen = await sample(page);
await toggleRecall(page);
states.recalled = await sample(page);

// ── 6. the keyboard path: arrow keys move the cursor, Enter runs 聚焦 ────────
// The cursor is read with a DOM-only probe: sampling (which hides the overlay to
// attribute its pixels) would blur the focused panel before `Enter` is pressed.
await toggleRecall(page);
const fileRowIndex = await page.evaluate(
  ({ view, rowSelector }) =>
    [...globalThis.__deep.all(rowSelector)].findIndex(
      (row) => row.getAttribute("data-prac-recall-row") === view,
    ),
  { view: FILE_VIEW, rowSelector: ROW },
);
if (fileRowIndex < 0) throw new Error("the file view is not a row in the recall catalogue");
for (let step = 0; step < fileRowIndex; step += 1) await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const selectedRow = await page.evaluate(
  () =>
    globalThis.__deep.one("[data-prac-recall-selected]")?.getAttribute("data-prac-recall-row") ??
    null,
);
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
await toggleRecall(page);
states.cursorMoved = selectedRow;
states.focusedByKey = await sample(page);

// ── 7. move via 移到 (the select): the file lands in the track it left ───────
await moveViaOverlay(page, FILE_VIEW, "right");
states.movedBySelect = await sample(page);

// ── 8. 分栏 is a *view* verb: the editor leaves the `right` stack for a new pane
// beside it, and the conversation it shared that region with stays behind ────
await toggleRecall(page);
await page.click(splitOf(FILE_VIEW, "right"));
await page.waitForTimeout(800);
await page.waitForTimeout(800);
states.splitWhileOpen = await sample(page);
// The new pane is the region this split *added*: the track ids are no longer the
// whole story (the container layer gives each track named children), so diff
// against the sample taken just before the split.
const knownBefore = new Set(states.movedBySelect.regions.map((region) => region.id));
// The pane a split adds is a **region**: a split element may also be new here (the old region
// becomes a `column` split that carries its id), and picking that one would name the source.
const newRegion =
  states.splitWhileOpen.regions
    .filter((region) => region.split !== true)
    .map((region) => region.id)
    .find((id) => !knownBefore.has(id)) ?? null;
if (!newRegion) throw new Error("分栏 did not create a new region");
await toggleRecall(page);
states.split = await sample(page);
const newPane = states.split.regions.find((region) => region.id === newRegion) ?? null;
states.splitNewPane = newRegion;
states.newPanePaint = await paintAt(page, newPane, `[data-prac-region="${newRegion}"] > *`);
// The region the file came from: the conversation must still be rendering
// there, which is what "分栏必带视图" means on this path (the split cannot cost
// the source region its view).
states.sourcePanePaint = await paintAt(page, states.split.right, '[data-prac-region="right"] > *');

// ── 9. 收起 / 展开 a region from the UI ─────────────────────────────────────
// The width to come back to is **the width it had**, whatever the drags before did to it (a
// `Distribute` drag moves every block on the side, not just the two beside the sash).
states.regionOpenBeforeCollapse = await sample(page);
await toggleRecall(page);
await page.click(collapseOf("left"));
await page.waitForTimeout(800);
states.regionCollapsedOpen = await sample(page);
await toggleRecall(page);
states.regionCollapsed = await sample(page);
states.regionCollapsedPaint = await paintAt(page, states.regionCollapsed.host?.box, EDITOR_HOST);
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

// The sash is an absolute overlay and takes no flex space (frame.ts), so
// collapsing a region gives its full width back; there is no gutter to add.
const gutter = 0;

// Decision 21: this gate is the recall surface's **UI contract**, so it stays
// mostly as it is — what it drops is the model half of rules that are unit tests
// (`catalogue.spec.ts` for the id join, `upload`'s own specs for placement), and
// what it merges is the per-state pixel evidence, which is worth one assertion
// per phase rather than one per state.
const checks = {
  // 1. the keybinding toggles, the surface is painted, Escape dismisses it.
  keyOpens: !states.default.overlay && !!states.opened.overlay,
  overlayPainted: painted(states.opened.overlayPaint),
  keyCloses: !!states.opened.overlay && !states.closedByKey.overlay,
  escapeDismisses: !!states.opened.overlay && !states.dismissed.overlay,
  // The attention strip the recall surface sits beside is untouched.
  stripStillPresent: states.default.strip && states.opened.strip && states.split.strip,

  // 2. the offered catalogue is the real registries joined — DSH's own slots and
  // the file seat — and the DOM renders exactly it.
  catalogueJoinsTheRealRegistries:
    catalogueIds(states.opened).includes("dsh:sidebar") &&
    catalogueIds(states.opened).includes("dsh:main:conversation") &&
    catalogueIds(states.opened).includes("dsh:rightbar") &&
    catalogueIds(states.opened).includes(FILE_VIEW) &&
    // The version is what told a subscribed UI to re-read; with the real plugins
    // registered it must have moved off zero.
    states.opened.catalogueVersion > 0,
  rowsMatchCatalogue: rowIds(states.opened).join(",") === catalogueIds(states.opened).join(","),
  regionsMatchCatalogue:
    regionControlIds(states.opened).join(",") === regionInfoIds(states.opened).join(","),
  hiddenViewOffered: states.opened.rows.find((row) => row.id === "dsh:rightbar")?.hidden === "true",

  // 3. 移到: the conversation leaves the track and the file takes it over.
  conversationMovedOutOfTheTrack:
    (states.conversationMoved.modelViews[CONVERSATION_VIEW]?.region ?? "").startsWith("left") &&
    states.conversationMoved.right === null,
  fileMovedIntoTheTrack:
    states.fileInTrack.host?.region === "right" && painted(states.fileInTrack.editorPaint),

  // 4. hide: `right` collapses to nothing, and the regions that remain paint.
  hideCollapsedTheTrack:
    states.hidden.right === null &&
    states.hidden.hostCount === 0 &&
    painted(states.hiddenRestPaint),
  hideOffersShow:
    states.hiddenWhileOpen.rows.find((row) => row.id === FILE_VIEW)?.hidden === "true",

  // 5. recall: back in `right`, at the dragged width, and painting.
  recallReturnedToRight: states.recalled.host?.region === "right",
  spaceAndWidthComeBack:
    states.hidden.stage.w === states.dragged.stage.w + dragWidth + gutter &&
    states.recalled.right?.w === dragWidth &&
    states.recalled.stage.w === states.dragged.stage.w,
  paintedAfterHideAndRecall: painted(states.recalled.editorPaint),

  // 6. arrow keys move the cursor; Enter runs the selected row's 聚焦.
  arrowsMoveCursor: states.cursorMoved === FILE_VIEW,
  enterFocusedIntoTheCentre:
    states.focusedByKey.host?.region === "center" &&
    // The conversation parks in the track instead of the track emptying out:
    // one view holds a region, and the one that yields stays on screen.
    states.focusedByKey.conversationRegion === "right",
  paintedAfterFocus: painted(states.focusedByKey.editorPaint),

  // 7. 移到: the view renders in the destination, and the source region's space
  // is reclaimed (the centre returns to the width it had before the move out).
  selectMoveLandedAndReclaimed:
    states.movedBySelect.host?.region === "right" &&
    states.movedBySelect.right?.w === dragWidth &&
    states.movedBySelect.stage.w === states.dragged.stage.w,
  paintedAfterMove: painted(states.movedBySelect.editorPaint),

  // 8. 分栏: the view lands in a new pane beside the one it was in, the pane it
  // left keeps the view it shared that region with, and both paint.
  splitCreatedPane: !!newPane,
  splitPaneBesideSource: sideBySide(states.split.right, newPane),
  splitSourceKeptItsView:
    (states.split.modelViews[CONVERSATION_VIEW]?.region ?? "").split("/stack/")[0] === "right" &&
    states.split.hostCount === 1,
  splitEditorPaintedInNewPane:
    painted(states.split.editorPaint) && states.split.host?.region === newRegion,
  splitSourcePanePainted: painted(states.sourcePanePaint),

  // 9. 收起 / 展开 a region: the region goes to 0 (still present) and the UI
  // offers 展开; expanding restores the width it had.
  collapseThenExpandFromTheUi:
    states.regionCollapsed.left?.w === 0 &&
    states.regionCollapsedOpen.regionCollapseStates.left === "true" &&
    states.regionExpanded.left?.w === states.regionOpenBeforeCollapse.left?.w,
  regionCollapseStillPaints: painted(states.regionCollapsedPaint),
};

const report = {
  url,
  checks,
  evidence: {
    editorView: FILE_VIEW,
    dragWidth,
    hidden: {
      regions: paneIds(states.hidden),
      stage: states.hidden.stage?.w,
      draggedStage: states.dragged.stage?.w,
    },
    recall: {
      region: states.recalled.host?.region,
      width: states.recalled.right?.w,
      modelSize: states.recalled.modelSizes.right?.size,
      stage: states.recalled.stage?.w,
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
