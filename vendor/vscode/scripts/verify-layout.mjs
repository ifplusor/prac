/**
 * Verify prac's nested region tree: default shape, split, sash drag, and
 * collapse-that-remembers-width.
 *
 * A layout bug is exactly where DOM checks lie: the regions are present, the
 * part is mounted, the tree is right — and the editor is blank (the
 * "structurally present, visually empty" failure this repo hit twice). So every
 * state is judged on pixels: screenshot the VS part host's clip, decode it in
 * the page, count distinct colours, and compare against the same clip with the
 * host hidden.
 *
 * The layout mechanism is driven from the page through `globalThis.__pracLayout`
 * (see the comment in `prac-client-ui-layout/src/client.ts`): a DSH client bundle's
 * `require` resolves only registered bundle ids, so a driver script cannot reach
 * the Cordis context any other way. `split`/`setCollapsed` are the mechanism's
 * own face; no internals are poked.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' node scripts/verify-layout.mjs
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

/**
 * The region the arrangement (`prac-web-app`'s client half, DEFAULT_PLACEMENTS)
 * asks for the `vscode:editor` view. The DOM must agree with the placement table.
 */
const ARRANGED_EDITOR_REGION = "right";

/**
 * The view id the editor seat (`prac-client-ui-vscode-editor`) declares and the
 * arrangement places.
 */
const EDITOR_VIEW = "vscode:editor";

/**
 * The part the app mounts behind each view.
 *
 * The DOM marks **part** ids ({ PART_HOST_ATTR}), while the frame and this
 * script speak **view** ids (`ctx.pracLayout`), so the two have to be related
 * here rather than assumed equal.
 */
const PART_OF_VIEW = {
  "vscode:editor": "workbench.parts.editor",
  "vscode:sidebar": "workbench.parts.sidebar",
};
const VIEW_OF_PART = Object.fromEntries(
  Object.entries(PART_OF_VIEW).map(([view, part]) => [part, view]),
);

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
    const sash = document.querySelector(sel);
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

/** Read the region tree, the rendered geometry, and the part's paint. */
async function sample(page) {
  const facts = await page.evaluate(
    ({ editorView, viewOfPart }) => {
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
      const regions = [...document.querySelectorAll("[data-prac-region]")].map((element) => ({
        id: element.getAttribute("data-prac-region"),
        box: box(element),
      }));
      const byId = (id) => regions.find((region) => region.id === id) ?? null;

      // The panes of the split that holds the `console` region.
      const panesOf = (regionId) => {
        const region = document.querySelector(`[data-prac-region="${regionId}"]`);
        const split = region?.parentElement?.closest("[data-prac-split]") ?? null;
        return split
          ? [...split.children]
              .filter((child) => child.matches("[data-prac-region]"))
              .map((child) => ({ id: child.getAttribute("data-prac-region"), box: box(child) }))
          : [];
      };
      const consolePanes = panesOf("stage");
      const rightPanes = panesOf("right");

      const hosts = [...document.querySelectorAll("[data-vscode-embed-part-host]")].map(
        (element) => ({
          view: viewOfPart[element.getAttribute("data-vscode-embed-part-host")] ?? null,
          region: element.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
          editor: !!element.querySelector(".editor-group-container"),
          box: box(element),
        }),
      );

      // The model, so the placement and cached-size restore are checked as state
      // and not only as pixels.
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
        frame: box(document.querySelector("[data-prac-frame]")),
        regions,
        right: byId("right"),
        console: byId("stage"),
        consolePanes,
        consoleExtent: consolePanes.reduce((total, pane) => total + (pane.box?.w ?? 0), 0),
        rightPanes,
        rightExtent: rightPanes.reduce((total, pane) => total + (pane.box?.h ?? 0), 0),
        splits: [...document.querySelectorAll("[data-prac-split]")].map((element) => ({
          id: element.getAttribute("data-prac-split"),
          dir: element.getAttribute("data-prac-split-dir"),
          box: box(element),
        })),
        sashes: [...document.querySelectorAll("[data-prac-sash]")].map((element) => ({
          id: element.getAttribute("data-prac-sash"),
          left: element.getAttribute("data-prac-sash-left"),
          right: element.getAttribute("data-prac-sash-right"),
          box: box(element),
        })),
        conversationInConsole: !!document.querySelector(
          '[data-prac-region="stage"] [data-slot="main.conversation"], [data-prac-region="stage"] [data-conversation-scroll]',
        ),
        editor: hosts.find((host) => host.editor) ?? null,
        modelEditorRegion: state?.views?.[editorView]?.region ?? null,
        modelRightSize: regionOf(state?.tree, "right")?.size ?? null,
        modelRightCollapsed: regionOf(state?.tree, "right")?.collapsed ?? null,
      };
    },
    { editorView: EDITOR_VIEW, viewOfPart: VIEW_OF_PART },
  );

  let paint = null;
  const host = facts.editor;
  if (host && host.box.w > 2 && host.box.h > 2) {
    const clip = { x: host.box.x, y: host.box.y, width: host.box.w, height: host.box.h };
    const painted = await page.screenshot({ clip });
    // Attribute the pixels: the same clip with the part host hidden must differ.
    const hide = (visibility) =>
      page.evaluate((value) => {
        const element = [...document.querySelectorAll("[data-vscode-embed-part-host]")].find(
          (candidate) => candidate.querySelector(".editor-group-container"),
        );
        if (element) element.style.visibility = value;
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
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForSelector("[data-vscode-embed-part-host]", { timeout: 60_000 });
// Give Monaco a beat to paint after the grid lays it out.
await page.waitForTimeout(3000);

const probeReady = await page.evaluate(
  () =>
    typeof globalThis.__pracLayout?.split === "function" &&
    typeof globalThis.__pracLayout?.setCollapsed === "function" &&
    typeof globalThis.__pracLayout?.place === "function",
);
if (!probeReady)
  throw new Error("globalThis.__pracLayout is not reachable; the page probe is missing");

/** Call one method on the plugin's own layout face. */
const act = (name, ...args) =>
  page.evaluate(({ method, params }) => globalThis.__pracLayout[method](...params), {
    method: name,
    params: args,
  });

const states = {};
states.default = await sample(page);

// ── split: `console` becomes a row of two flexible panes ─────────────────────
await act("split", "stage");
await page.waitForTimeout(900);
states.split = await sample(page);

// ── drag: the `console | right` boundary moves ~120px left, shrinking `right`
await dragSash(page, '[data-prac-sash-right="right"]', 120);
states.resized = await sample(page);

// ── move attention out of `right` so collapse cannot blank the part ──────────
// The default keeps the editor in `right`; collapsing then inevitably hides it,
// so the collapse phase first places the part in `console` through the plugin's
// own `place`. The width restore is still checked on `right` itself.
await act("place", EDITOR_VIEW, "stage");
await page.waitForTimeout(1200);
states.moved = await sample(page);

// ── collapse remembers width ─────────────────────────────────────────────────
// The pre-collapse reference is the dragged width (the last state where `right`
// was rendered); moving the part out makes the empty region take no space, so
// the reference must be read before the move.
const preCollapseDom = states.resized.right?.box?.w ?? null;
const preCollapseModel = states.resized.modelRightSize;
await act("setCollapsed", "right", true);
await page.waitForTimeout(900);
states.collapsed = await sample(page);

await act("setCollapsed", "right", false);
await page.waitForTimeout(900);
states.expanded = await sample(page);

// Put the part back where the restore is visible as a real region.
await act("place", EDITOR_VIEW, "right");
await page.waitForTimeout(1200);
states.restored = await sample(page);

// ── column: a `column` split resizes on dy, not just dx ──────────────────────
// Splitting `right` (fixed, so not flex|flex) gives a vertical boundary whose
// drag must change heights. A reload resets to the default tree — no unsplit
// exists, and this phase is about the other axis.
await page.reload({ waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForSelector("[data-vscode-embed-part-host]", { timeout: 60_000 });
await page.waitForTimeout(2500);
await act("split", "right", "column");
await page.waitForTimeout(900);
states.columnSplit = await sample(page);
await dragSash(page, '[data-prac-sash-dir="column"]', 0, 150);
states.columnResized = await sample(page);

await page.screenshot({ path: resolve(repoRoot, ".build/layout.png") });
await browser.close();

/** The paint evidence every state must show: real content, attributed to the clip. */
const painted = (state) =>
  !!state.paint && state.paint.distinctColours > 4 && state.paint.differsWhenHidden === true;
const within = (value, low, high) => typeof value === "number" && value >= low && value <= high;
const paneIds = (state) => state.consolePanes.map((pane) => pane.id).join(",");
const sideBySide = (state) =>
  state.consolePanes.length === 2 &&
  state.consolePanes[0].box.y === state.consolePanes[1].box.y &&
  state.consolePanes[0].box.x < state.consolePanes[1].box.x;
const stacked = (state) =>
  state.rightPanes.length === 2 &&
  state.rightPanes[0].box.x === state.rightPanes[1].box.x &&
  state.rightPanes[0].box.y < state.rightPanes[1].box.y;

const dragShrink = states.split.right.box.w - states.resized.right.box.w;
const dragGrowth = states.resized.consoleExtent - states.split.consoleExtent;
const collapseGrowth = states.collapsed.consoleExtent - states.resized.consoleExtent;
const columnGrowth = states.columnResized.right.box.h - states.columnSplit.right.box.h;

const checks = {
  // default: the tree reproduces today's row, with the right occupants.
  defaultRegions:
    states.default.regions.map((region) => region.id).join(",") === "left,stage,right",
  defaultConversationInConsole: states.default.conversationInConsole === true,
  defaultEditorInRight: states.default.editor?.region === "right",
  defaultRightPainted: painted(states.default),
  // The arrangement's ask vs what actually rendered: the editor view is placed
  // in the region the arrangement names (DEFAULT_PLACEMENTS → `right`), the
  // mechanism's placement table agrees, and the DOM region is that region.
  defaultEditorPlacedAsArranged:
    states.default.modelEditorRegion === ARRANGED_EDITOR_REGION &&
    states.default.editor?.region === states.default.modelEditorRegion &&
    states.default.editor?.view === EDITOR_VIEW,

  // split: two panes in `console`, the editor untouched and still painting.
  splitTwoPanes:
    states.split.consolePanes.length === 2 &&
    states.split.consolePanes.every((pane) => pane.box.w > 100),
  splitPanesSideBySide: sideBySide(states.split),
  splitEditorPainted: painted(states.split) && states.split.editor?.region === "right",

  // drag: the boundary actually moved both neighbours — a stale size would not.
  dragShrankRight: within(dragShrink, 100, 140),
  dragGaveSpaceToConsole: within(dragGrowth, 100, 140),
  dragEditorPainted: painted(states.resized) && states.resized.editor?.region === "right",

  // collapse: `right` goes to zero, `console` takes exactly that space.
  collapsedEditorMovedToConsole: states.moved.editor?.region === "stage",
  collapsedEditorPainted: painted(states.collapsed) && states.collapsed.editor?.region === "stage",
  collapsedRightZero:
    states.collapsed.right?.box.w === 0 &&
    states.collapsed.modelRightSize === 0 &&
    states.collapsed.modelRightCollapsed === true,
  collapsedConsoleGrew: within(collapseGrowth, preCollapseDom - 20, preCollapseDom + 20),

  // expand: the cached width comes back — in the model and, once the part is
  // back in `right`, as a real painted region of the same width.
  expandRestoredModelSize:
    states.expanded.modelRightSize === preCollapseModel &&
    states.expanded.modelRightCollapsed === false,
  expandEditorPainted: painted(states.expanded),
  restoredEditorInRight: states.restored.editor?.region === "right",
  restoredRightDomWidth: states.restored.right?.box.w === preCollapseDom,
  restoredEditorPainted: painted(states.restored),

  // column: the same drag on dy moves a vertical boundary.
  columnTwoPanes:
    states.columnSplit.rightPanes.length === 2 &&
    states.columnSplit.rightPanes.every((pane) => pane.box.h > 100),
  columnPanesStacked: stacked(states.columnSplit),
  columnDragChangedHeight: within(columnGrowth, 130, 170),
  columnEditorPainted:
    painted(states.columnResized) && states.columnResized.editor?.region === "right",
};

const report = {
  url,
  checks,
  evidence: {
    arrangement: {
      askedRegion: ARRANGED_EDITOR_REGION,
      modelRegion: states.default.modelEditorRegion,
      domRegion: states.default.editor?.region,
    },
    drag: {
      from: states.split.right.box.w,
      to: states.resized.right.box.w,
      shrink: dragShrink,
      consoleGrowth: dragGrowth,
    },
    collapse: {
      preCollapseDom,
      preCollapseModel,
      consoleGrowth: collapseGrowth,
      rightAfter: states.collapsed.right?.box.w,
      modelAfter: states.collapsed.modelRightSize,
    },
    expand: {
      modelRight: states.expanded.modelRightSize,
      restoredDomWidth: states.restored.right?.box.w,
    },
    column: {
      from: states.columnSplit.right.box.h,
      to: states.columnResized.right.box.h,
      growth: columnGrowth,
    },
    paneIds: { split: paneIds(states.split), resized: paneIds(states.resized) },
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
  "\nOK: the region tree splits, resizes by sash, and collapse restores the cached width — with the editor painting throughout and placed where the arrangement asks.",
);
