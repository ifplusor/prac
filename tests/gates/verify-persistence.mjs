/**
 * Verification of **persistence** (decision 16): the frame's state survives a
 * reload, and the arrangement's defaults fill gaps instead of overwriting it.
 *
 *  1. **a fresh origin starts from the factory shape** — clear the key, reload,
 *     and the frame is the default tree with the default placements (so what
 *     follows is the frame's doing, not the page's);
 *  2. **state is written** — after resizing the left track, selecting the
 *     Explorer container (which is one of the app's, inside the track) and folding
 *     a view in it, moving the conversation into the bottom bar and opening it,
 *     the versioned key holds the state;
 *  3. **state is restored** — after `page.reload()` the same facts hold in the
 *     DOM: the resized track, both stack entries with the second still folded,
 *     the bottom bar still filled and open, the same region list;
 *  4. **no rehydration failure** — the engine rehydrates whatever is under the
 *     key without validating it, so a shape change that forgets to bump the key
 *     surfaces here rather than as a half-broken frame.
 *
 * (3) is what the gate is really about: with the arrangement re-asserting
 * `DEFAULT_PLACEMENTS` on every activation, the conversation would jump back to
 * the stage and the sidebar's second view would be hidden again on reload —
 * "persistence" that undoes itself. `arrange()` therefore skips views the state
 * already knows.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:persistence
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const LEFT = "left";
const BOTTOM = "bottom";
const CONVERSATION = "dsh:main:conversation";
const VSCODE_SIDEBAR = "vscode:view:workbench.explorer.fileView";
/** The key `prac-client-ui-layout` persists under (see its `store.ts`). */
const STATE_KEY = "prac-layout/v2";
/** The sidebar's default size; a restored 320 can only be the resize. */
const RESIZED_LEFT = 320;
const DEFAULT_LEFT = 280;

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);

/** Wait for the frame to be rendered after a navigation. */
async function settle() {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__pracLayout, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

/**
 * Read the frame's state from the DOM and from the persisted key.
 *
 * @returns {Promise<object>} the sample: region list and boxes, the left
 * region's stack entries with their fold flags, and what the key holds.
 */
async function sample() {
  return page.evaluate(
    ({ key, left, bottom }) => {
      const box = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      };
      /** Depth-first region lookup in the persisted tree. */
      const findRegion = (node, id) => {
        if (node === null || typeof node !== "object") return null;
        if (node.id === id) return node;
        for (const child of node.children ?? []) {
          const hit = findRegion(child, id);
          if (hit !== null) return hit;
        }
        return null;
      };
      const raw = localStorage.getItem(key);
      const state = raw === null ? null : JSON.parse(raw);
      return {
        regions: [...document.querySelectorAll("[data-prac-region]")].map((element) =>
          element.getAttribute("data-prac-region"),
        ),
        bottom: box(`[data-prac-region="${bottom}"]`),
        stack: [
          ...document.querySelectorAll(`[data-prac-region="${left}"] [data-prac-stack-entry]`),
        ].map((element) => ({
          view: element.getAttribute("data-prac-stack-entry"),
          collapsed: element.getAttribute("data-prac-stack-collapsed"),
        })),
        left: box(`[data-prac-region="${left}"]`),
        // The **content**, not just the chrome: a container whose panes come back as
        // headers only renders every stack body at zero height, and the file tree it
        // holds has no rows — the symptom a person reports as "the file tree is gone".
        // Measured on the bug this criterion exists for: bodies 0, rows 0 after a reload.
        panes: {
          bodies: [
            ...document.querySelectorAll(`[data-prac-region="${left}"] [data-prac-stack-body]`),
          ].map((element) => Math.round(element.getBoundingClientRect().height)),
          // Rows live inside the view's isolation root, which `querySelectorAll` cannot
          // cross: walk into every shadow root under the region.
          treeRows: (() => {
            let rows = 0;
            const walk = (node) => {
              rows += node.querySelectorAll?.(".monaco-list-row").length ?? 0;
              for (const element of node.querySelectorAll?.("*") ?? []) {
                if (element.shadowRoot) walk(element.shadowRoot);
              }
            };
            const region = document.querySelector(`[data-prac-region="${left}"]`);
            if (region) walk(region);
            return rows;
          })(),
        },
        // Which container the region shows: the container layer's own state.
        activeContainer:
          document
            .querySelector(`[data-prac-region="${left}"] [data-prac-container-active="true"]`)
            ?.getAttribute("data-prac-container") ?? null,
        persisted:
          state === null
            ? null
            : {
                bytes: raw.length,
                leftSize: findRegion(state.tree, left)?.size ?? null,
                bottomCollapsed: findRegion(state.tree, bottom)?.collapsed ?? null,
                views: Object.keys(state.views ?? {}).sort(),
              },
      };
    },
    { key: STATE_KEY, left: LEFT, bottom: BOTTOM },
  );
}

// 1. A fresh origin: clear the key, reload, and start from the factory shape.
await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await settle();
const initial = await sample();

// 2. Move things: resize the track, show + fold a second view in the sidebar,
//    push the conversation into the bottom bar and open it.
// The VS Code sidebar's region is its **container child**, discovered from the
// catalogue rather than assumed: the container layer is what puts it there.
const SIDEBAR_REGION = await page.evaluate(
  (view) => globalThis.__pracLayout.listViews().find((entry) => entry.id === view)?.region ?? null,
  VSCODE_SIDEBAR,
);
await page.evaluate(
  ({ left, bottom, conversation, vscodeSidebar, sidebarRegion, width }) => {
    const layout = globalThis.__pracLayout;
    layout.setWidth(left, width);
    // Showing the container's view selects that container: the region now shows
    // the Explorer rather than prac's own sidebar.
    layout.place(vscodeSidebar, sidebarRegion);
    layout.setViewCollapsed(vscodeSidebar, true);
    layout.place(conversation, bottom);
    layout.setCollapsed(bottom, false);
  },
  {
    left: LEFT,
    bottom: BOTTOM,
    conversation: CONVERSATION,
    vscodeSidebar: VSCODE_SIDEBAR,
    sidebarRegion: SIDEBAR_REGION,
    width: RESIZED_LEFT,
  },
);
await page.waitForTimeout(1500);
const changed = await sample();

// 2b. Seed the two shapes the boot must tell apart: a region the **embedder** created and left
// empty (its group's files are gone with the last page — files are not restored across a reload,
// so no group and no chrome is left to close it), and an empty region the app's own layout made
// (its view simply has not been placed yet — `verify:split` restores a geometry through one).
await page.evaluate(
  ({ key }) => {
    const raw = JSON.parse(localStorage.getItem(key));
    const region = (id, embedder) => ({
      type: "region",
      id,
      size: 0,
      flex: true,
      collapsed: false,
      cachedSize: 0,
      min: 120,
      ...(embedder ? { embedder: true } : {}),
    });
    raw.tree.children.push(region("region-stale", true), region("region-keep", false));
    localStorage.setItem(key, JSON.stringify(raw));
  },
  { key: STATE_KEY },
);

// 3. Reload: everything above has to come back.
await page.reload({ waitUntil: "load" });
await settle();
const reloaded = await sample();
// Which regions the restored tree still holds — read while the page is open (the teardown closes
// the browser).
const restoredRegions = await page.evaluate(
  ({ key }) => {
    const found = [];
    const walk = (node) => {
      if (node.type === "region") {
        found.push(node.id);
        for (const child of node.children ?? []) walk(child);
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(JSON.parse(localStorage.getItem(key)).tree);
    return found;
  },
  { key: STATE_KEY },
);

// 3b. And its **content** with it. The scenario above folds the sidebar on purpose, so the
// folded entry has no body to measure; unfolding it has to give the pane a real body and the
// file tree its rows. Measured on the bug this locks: after a reload the entry came back but
// its body stayed at the header's height (0 content), and unfolding did not help — clearing
// the persisted key was the only way out.
const unfold = await page.evaluate((view) => {
  const toggle = document.querySelector(
    `[data-prac-stack-entry="${view}"] [data-prac-stack-toggle]`,
  );
  if (toggle === null) return null;
  const rect = toggle.getBoundingClientRect();
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}, VSCODE_SIDEBAR);
if (unfold !== null) {
  await page.mouse.move(unfold.x, unfold.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(3000);
}
const unfolded = await sample();

await close();

const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;
/** The bar's own size, from the frame's tree. */
const BAR_HEIGHT = 240;

// Decision 21: the *semantics* this feature rests on are unit tests now — that
// `arrange` fills gaps instead of re-asserting its defaults, and that a state
// change is what the store is asked to keep. What a live page owns is the
// integration itself: DSH's store engine writing under the versioned key, and the
// next boot rehydrating it. So every surviving assertion is **absolute** (it
// states what must be true after the reload), never "the same as before" — a
// relative check passes vacuously when the change never happened.
const checks = {
  // The premise: a fresh origin really starts from the factory shape.
  // The factory shape is now "the tracks, with the app's containers in them":
  // the sidebar at its default width and the bar present because the catalogue
  // put the panel containers there.
  startedDefault:
    near(initial.left?.w, DEFAULT_LEFT, 6) &&
    initial.regions.filter((region) => !region.includes("/")).join(",") === "left,stage,bottom",
  // The engine integration: the state is under the versioned key, and it is the
  // state the moves produced (not just a key that exists).
  written: changed.persisted !== null && changed.persisted.leftSize === RESIZED_LEFT,
  // …and comes back after a real reload: size, the selected container with its
  // fold, bar. `activeContainer` is the container layer's own persistent state —
  // which container a region shows — so it belongs in this gate.
  resizeRestored: near(reloaded.left?.w, RESIZED_LEFT, 6),
  containerRestored:
    reloaded.activeContainer !== null &&
    reloaded.activeContainer === changed.activeContainer &&
    reloaded.stack.some((entry) => entry.view === VSCODE_SIDEBAR && entry.collapsed === "true"),
  bottomRestored: reloaded.bottom !== null && near(reloaded.bottom?.h, BAR_HEIGHT, 6),
  // The panes' **contents** survive the reload too: every stack body in the sidebar has
  // a real height (not the 22px header) and the file tree inside it has rows.
  containerContentRestored:
    unfolded.panes.bodies.length > 0 &&
    unfolded.panes.bodies.every((height) => height > 40) &&
    unfolded.panes.treeRows > 0,
  // The leftover is gone, and the app's own empty region is still there.
  staleRegionPruned:
    !restoredRegions.includes("region-stale") && restoredRegions.includes("region-keep"),
  // No rehydration or persistence complaint from the engine.
  noErrors:
    own("__pracLayout").length === 0 &&
    own("prac-client-ui-layout").length === 0 &&
    own("vscode-embed:").length === 0 &&
    own("rehydration").length === 0 &&
    own("persistence failed").length === 0,
};

report({
  url,
  facts: { initial, changed, reloaded, consoleErrors },
  checks,
  ok: "OK: the frame's state (track size, stack order, fold, bottom bar) is written under the versioned key and comes back after a reload, with the arrangement's defaults only filling gaps.",
});
