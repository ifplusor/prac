/**
 * Verify prac's nested region tree: default shape, split, sash drag, and
 * collapse-that-remembers-width — with the current **file view** as the subject
 * that must keep painting.
 *
 * Since decision 17 the editor is one view per open file
 * (`vscode:file:<resource>`, host `[data-vscode-embed-file]`), and opening a file
 * is what the arrangement answers with `openFileInto`: the file takes the centre
 * and the conversation parks in the right track. A layout bug is exactly where
 * DOM checks lie: the regions are present, the view is mounted, the tree is right
 * — and the editor is blank (the "structurally present, visually empty" failure
 * this repo hit twice). So every state is judged on pixels: screenshot the file
 * host's clip, decode it in the page, count distinct colours, and compare against
 * the same clip with the host hidden.
 *
 * The layout mechanism is driven from the page through `globalThis.__pracLayout`
 * (see the comment in `prac-client-ui-layout/src/client.ts`): a DSH client bundle's
 * `require` resolves only registered bundle ids, so a driver script cannot reach
 * the Cordis context any other way. `split`/`setCollapsed` are the mechanism's
 * own face; no internals are poked.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-layout.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom } from "./deep-dom.mjs";
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

/**
 * The region the arrangement (`prac-web-app`'s client half, `openFileInto`) asks
 * for a newly opened file. The DOM must agree with the placement policy.
 */
const ARRANGED_FILE_REGION = "stage";

/**
 * The view id a file view carries by convention (`prac-client-vscode-host`); the
 * exact resource is discovered live, because the workspace is a session fact.
 */
const FILE_VIEW_PREFIX = "vscode:file:";

/**
 * The arrangement's own centre occupant, used as the *view* the row split
 * carries: `splitView` moves a view into the pane it creates, so a split needs a
 * view to name (decision 15/20 — a split never creates an empty pane).
 */
const CONVERSATION_VIEW = "dsh:main:conversation";

/**
 * A fixed-region occupant, so a split has a region that stays on screen. A
 * *fixed* region that empties is not rendered at all — no region, no sash,
 * nothing to drag — so the file view is split out of a region the sidebar keeps
 * occupied.
 */
const VSCODE_SIDEBAR_VIEW = "vscode:view:workbench.explorer.fileView";

/** The track the conversation parks in when a file takes the centre. */
const TRACK_REGION = "right";

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

/** Drag the sash matching `selector` by (`dx`, `dy`) px. */
async function dragSash(page, selector, dx, dy = 0) {
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
    await page.mouse.move(point.x + (dx * step) / 12, point.y + (dy * step) / 12, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Read the region tree, the rendered geometry, and the file view's paint. */
async function sample(page, fileView) {
  const facts = await page.evaluate(
    ({ fileView, trackRegion }) => {
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
      const regions = [...globalThis.__deep.all("[data-prac-region]")].map((element) => ({
        id: element.getAttribute("data-prac-region"),
        box: box(element),
      }));
      const byId = (id) => regions.find((region) => region.id === id) ?? null;

      // The direct region siblings of the split that directly holds `regionId`:
      // the two panes a sash between them moves.
      const panesOf = (regionId) => {
        const region = globalThis.__deep.one(`[data-prac-region="${regionId}"]`);
        const split = region?.parentElement?.closest("[data-prac-split]") ?? null;
        return split
          ? [...split.children]
              .filter((child) => child.matches("[data-prac-region]"))
              .map((child) => ({ id: child.getAttribute("data-prac-region"), box: box(child) }))
          : [];
      };

      const host = globalThis.__deep.one("[data-vscode-embed-file]");
      const state = globalThis.__pracLayout?.getState?.();
      const regionOf = (node, id) => {
        if (!node) return null;
        if (node.type === "region") return node.id === id ? node : null;
        for (const child of node.children) {
          const found = regionOf(child, id);
          if (found) return found;
        }
        return null;
      };

      return {
        frame: box(globalThis.__deep.one("[data-prac-frame]")),
        regions,
        right: byId(trackRegion),
        rightPanes: panesOf(trackRegion),
        // Every region except the track: the extent that absorbs a collapse.
        othersExtent: regions
          .filter((region) => region.id !== trackRegion)
          .reduce((total, region) => total + (region.box?.w ?? 0), 0),
        sashes: [...globalThis.__deep.all("[data-prac-sash]")].map((element) => ({
          id: element.getAttribute("data-prac-sash"),
          left: element.getAttribute("data-prac-sash-left"),
          right: element.getAttribute("data-prac-sash-right"),
          dir: element.getAttribute("data-prac-sash-dir"),
          box: box(element),
        })),
        // The conversation's DOM lives inside its own view root, so the region
        // it sits in is read by walking *out* of the root rather than by a
        // descendant selector (which cannot cross the boundary).
        conversationInTrack: globalThis.__deep
          .all('[data-slot="main.conversation"], [data-conversation-scroll]')
          .some(
            (element) =>
              globalThis.__deep
                .closest(element, "[data-prac-region]")
                ?.getAttribute("data-prac-region") === trackRegion,
          ),
        file: host
          ? {
              region:
                globalThis.__deep
                  .closest(host, "[data-prac-region]")
                  ?.getAttribute("data-prac-region") ?? null,
              box: box(host),
              lines: host.querySelectorAll(".view-line").length,
            }
          : null,
        fileHostCount: globalThis.__deep.all("[data-vscode-embed-file]").length,
        modelFileRegion: state?.views?.[fileView]?.region ?? null,
        modelConversationRegion: state?.views?.["dsh:main:conversation"]?.region ?? null,
        modelRightSize: regionOf(state?.tree, trackRegion)?.size ?? null,
        modelRightCollapsed: regionOf(state?.tree, trackRegion)?.collapsed ?? null,
      };
    },
    { fileView, trackRegion: TRACK_REGION },
  );

  let paint = null;
  const host = facts.file;
  if (host && host.box.w > 2 && host.box.h > 2) {
    const clip = { x: host.box.x, y: host.box.y, width: host.box.w, height: host.box.h };
    const painted = await page.screenshot({ clip });
    // Attribute the pixels: the same clip with the file host hidden must differ.
    const hide = (visibility) =>
      page.evaluate((value) => {
        globalThis.__deep.all("[data-vscode-embed-file]").forEach((element) => {
          element.style.visibility = value;
        });
      }, visibility);
    await hide("hidden");
    const hidden = await page.screenshot({ clip });
    await hide("");
    paint = {
      ...(await page.evaluate(analyse, painted.toString("base64"))),
      sha: sha(painted).slice(0, 12),
      differsWhenHidden: sha(painted) !== sha(hidden),
    };
  }
  return { ...facts, paint };
}

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

// Open one file: the arrangement puts it in the centre and sends the conversation
// to the track. This is the model's factory shape, so it is where the gate starts.
const folder = await page.evaluate(
  () => (globalThis.__vscodeEmbed.face.workspaceInfo().folders ?? [])[0] ?? null,
);
if (!folder) throw new Error("the workbench has no workspace folder");
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), `${folder}/package.json`);
await page.waitForSelector("[data-vscode-embed-file] .monaco-editor", { timeout: 60_000 });
await page.waitForTimeout(3000);

const probeReady = await page.evaluate(
  () =>
    typeof globalThis.__pracLayout?.splitView === "function" &&
    typeof globalThis.__pracLayout?.setCollapsed === "function" &&
    typeof globalThis.__pracLayout?.place === "function",
);
if (!probeReady)
  throw new Error("globalThis.__pracLayout is not reachable; the page probe is missing");

const fileView = await page.evaluate(
  (prefix) =>
    globalThis.__pracLayout
      .listViews()
      .map((view) => view.id)
      .find((id) => id.startsWith(prefix)) ?? null,
  FILE_VIEW_PREFIX,
);
if (!fileView) throw new Error("no file view was declared after opening a file");

/** Call one method on the plugin's own layout face. */
const act = (name, ...args) =>
  page.evaluate(({ method, params }) => globalThis.__pracLayout[method](...params), {
    method: name,
    params: args,
  });
const read = () => sample(page, fileView);

const states = {};
states.default = await read();

// ── split: the conversation leaves the track for a pane the sidebar keeps alive ─
// `splitView` is view-centric: it creates the pane *for* the named view. The
// conversation is the track's only visible occupant, so the sidebar is placed
// there first — otherwise the emptied track would not render and there would be
// no pane to sit beside. The file, in the centre, is untouched.
await act("place", VSCODE_SIDEBAR_VIEW, TRACK_REGION);
await page.waitForTimeout(700);
await act("splitView", CONVERSATION_VIEW, TRACK_REGION);
await page.waitForTimeout(900);
states.split = await read();

// ── drag: the `right | new pane` boundary moves ~120px left, shrinking `right` ─
await dragSash(page, `[data-prac-sash-left="${TRACK_REGION}"]`, -120);
states.resized = await read();

// ── collapse remembers width ─────────────────────────────────────────────────
// The file is in the centre, so collapsing the track cannot blank it: the file
// keeps painting while the track's space goes to the flexible panes.
const preCollapseDom = states.resized.right?.box?.w ?? null;
const preCollapseModel = states.resized.modelRightSize;
const preCollapseOthers = states.resized.othersExtent;
await act("setCollapsed", TRACK_REGION, true);
await page.waitForTimeout(900);
states.collapsed = await read();

await act("setCollapsed", TRACK_REGION, false);
await page.waitForTimeout(900);
states.expanded = await read();

// ── column: a `column` split resizes on dy, not just dx ──────────────────────
// The file moves into the fixed track (which the sidebar still occupies) and is
// split out downwards: a fixed source keeps its size, so the pair is fixed|flex
// and the vertical boundary actually moves. Splitting the already-flexible
// centre would make a flex|flex pair, whose sash is inert by design.
await act("place", fileView, TRACK_REGION);
await page.waitForTimeout(900);
await act("splitView", fileView, "down");
await page.waitForTimeout(900);
states.columnSplit = await read();
await dragSash(page, '[data-prac-sash-dir="column"]', 0, 150);
states.columnResized = await read();

await page.screenshot({ path: resolve(repoRoot, ".build/layout.png") });
await browser.close();

/** The paint evidence every state must show: real content, attributed to the clip. */
const painted = (state) =>
  !!state.paint && state.paint.distinctColours > 4 && state.paint.differsWhenHidden === true;
const within = (value, low, high) => typeof value === "number" && value >= low && value <= high;
const paneIds = (state) => state.rightPanes.map((pane) => pane.id).join(",");
const sideBySide = (panes) =>
  panes.length === 2 &&
  panes[0].box.y === panes[1].box.y &&
  panes[0].box.x < panes[1].box.x &&
  panes[0].box.h === panes[1].box.h;
const stacked = (panes) =>
  panes.length === 2 &&
  panes[0].box.x === panes[1].box.x &&
  panes[0].box.y < panes[1].box.y &&
  panes[0].box.w === panes[1].box.w;

const paneWidth = (state, id) => state.rightPanes.find((pane) => pane.id === id)?.box.w ?? null;
const paneHeight = (state, id) => state.rightPanes.find((pane) => pane.id === id)?.box.h ?? null;
const otherPaneId = (state) =>
  state.rightPanes.find((pane) => pane.id !== TRACK_REGION)?.id ?? null;
const rowShrink = (state) => paneWidth(states.split, TRACK_REGION) - paneWidth(state, TRACK_REGION);
const rowGrowth = (state) => {
  const id = otherPaneId(states.split);
  return paneWidth(state, id) - paneWidth(states.split, id);
};
const collapseGrowth = states.collapsed.othersExtent - preCollapseOthers;
const columnPaneId = otherPaneId(states.columnSplit);
const columnGrowth =
  paneHeight(states.columnResized, columnPaneId) - paneHeight(states.columnSplit, columnPaneId);

// Decision 21: the mechanism's arithmetic (region geometry, `sashSizes`' clamps,
// `cachedSize` round-trip, where the placement table puts a view) is a unit test.
// This gate keeps the VS Code side of the arrangement: the file view is in the
// region the arrangement names and paints, a real mouse drag moves the rendered
// boundary — on both axes — and the file survives being moved, collapsed and
// expanded. Pixel assertions are merged per phase rather than repeated per state.
const checks = {
  // default: the file holds the centre and the conversation parks in the track.
  defaultRegions:
    states.default.regions.map((region) => region.id).join(",") === "left,stage,right",
  defaultConversationInTheTrack:
    states.default.modelConversationRegion === TRACK_REGION &&
    states.default.conversationInTrack === true,
  defaultFileInTheArrangedRegion:
    states.default.modelFileRegion === ARRANGED_FILE_REGION &&
    states.default.file?.region === states.default.modelFileRegion &&
    states.default.file?.lines > 3,
  paintedInTheDefault: painted(states.default),

  // split: two panes beside the fixed track, the file untouched in the centre.
  splitTwoPanesSideBySide:
    states.split.rightPanes.length === 2 &&
    states.split.rightPanes.every((pane) => pane.box.w > 100) &&
    sideBySide(states.split.rightPanes),
  splitFileUntouched: painted(states.split) && states.split.file?.region === ARRANGED_FILE_REGION,

  // drag: the boundary actually moved both neighbours — a stale size would not.
  dragMovedBothNeighbours:
    within(rowShrink(states.resized), 100, 140) && within(rowGrowth(states.resized), 100, 140),
  paintedAfterTheDrag: painted(states.resized),

  // collapse: the track goes to zero, the flexible panes take exactly that space,
  // and the file in the centre keeps painting.
  collapseZeroesAndGivesRoom:
    states.collapsed.right?.box?.w === 0 &&
    states.collapsed.modelRightSize === 0 &&
    states.collapsed.modelRightCollapsed === true &&
    within(collapseGrowth, preCollapseDom - 25, preCollapseDom + 25),
  paintedWhileCollapsed: painted(states.collapsed),

  // expand: the track is back, painted, at the width it had.
  restoreBringsBackTheTrack:
    states.expanded.right?.box?.w === preCollapseDom && painted(states.expanded),

  // column: the same drag on dy moves a vertical boundary.
  columnPanesStacked:
    states.columnSplit.rightPanes.length === 2 &&
    states.columnSplit.rightPanes.every((pane) => pane.box.h > 100) &&
    stacked(states.columnSplit.rightPanes),
  columnDragChangedHeight:
    within(Math.abs(columnGrowth), 130, 170) &&
    within(
      Math.abs(
        paneHeight(states.columnResized, TRACK_REGION) -
          paneHeight(states.columnSplit, TRACK_REGION),
      ),
      130,
      170,
    ),
  paintedAfterTheColumnSplit: painted(states.columnResized),
};

const report = {
  url,
  checks,
  evidence: {
    fileView,
    arrangement: {
      askedRegion: ARRANGED_FILE_REGION,
      modelRegion: states.default.modelFileRegion,
      domRegion: states.default.file?.region,
      conversationRegion: states.default.modelConversationRegion,
    },
    drag: {
      from: paneWidth(states.split, TRACK_REGION),
      to: paneWidth(states.resized, TRACK_REGION),
      shrink: rowShrink(states.resized),
      neighbourGrowth: rowGrowth(states.resized),
    },
    collapse: {
      preCollapseDom,
      preCollapseModel,
      othersGrowth: collapseGrowth,
      rightAfter: states.collapsed.right?.box?.w,
      modelAfter: states.collapsed.modelRightSize,
    },
    expand: {
      modelRight: states.expanded.modelRightSize,
      restoredDomWidth: states.expanded.right?.box?.w,
    },
    column: {
      panes: paneIds(states.columnSplit),
      from: paneHeight(states.columnSplit, columnPaneId),
      to: paneHeight(states.columnResized, columnPaneId),
      growth: columnGrowth,
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
  "\nOK: the region tree splits, resizes by sash on both axes, and collapse restores the cached width — with the file view painting throughout and placed where the arrangement asks.",
);
