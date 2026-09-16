/**
 * Verification of **persistence** (decision 16): the frame's state survives a
 * reload, and the arrangement's defaults fill gaps instead of overwriting it.
 *
 *  1. **a fresh origin starts from the factory shape** — clear the key, reload,
 *     and the frame is the default tree with the default placements (so what
 *     follows is the frame's doing, not the page's);
 *  2. **state is written** — after resizing the right track, showing + folding a
 *     second view in the left sidebar, moving the conversation into the bottom
 *     bar and opening it, the versioned key holds the state;
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
const VSCODE_SIDEBAR = "vscode:sidebar";
/** The key `prac-client-ui-layout` persists under (see its `store.ts`). */
const STATE_KEY = "prac-layout/v1";
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
await page.evaluate(
  ({ left, bottom, conversation, vscodeSidebar, width }) => {
    const layout = globalThis.__pracLayout;
    layout.setWidth(left, width);
    layout.show(vscodeSidebar);
    layout.setViewCollapsed(vscodeSidebar, true);
    layout.place(conversation, bottom);
    layout.setCollapsed(bottom, false);
  },
  {
    left: LEFT,
    bottom: BOTTOM,
    conversation: CONVERSATION,
    vscodeSidebar: VSCODE_SIDEBAR,
    width: RESIZED_LEFT,
  },
);
await page.waitForTimeout(1500);
const changed = await sample();

// 3. Reload: everything above has to come back.
await page.reload({ waitUntil: "load" });
await settle();
const reloaded = await sample();

await close();

const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;
/**
 * The left region's stack as `<view>:<folded>` in render order.
 *
 * @param entry - a sample.
 */
const stackKey = (entry) => entry.stack.map((item) => `${item.view}:${item.collapsed}`).join(",");
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
  startedDefault:
    initial.regions.join(",") === "left,stage" &&
    near(initial.left?.w, DEFAULT_LEFT, 6) &&
    initial.stack.length === 0 &&
    initial.bottom === null,
  // The engine integration: the state is under the versioned key, and it is the
  // state the moves produced (not just a key that exists).
  written: changed.persisted !== null && changed.persisted.leftSize === RESIZED_LEFT,
  // …and comes back after a real reload: size, stack order with the fold, bar.
  resizeRestored: near(reloaded.left?.w, RESIZED_LEFT, 6),
  stackRestored:
    reloaded.stack.length === 2 &&
    stackKey(reloaded) === stackKey(changed) &&
    reloaded.stack.some((entry) => entry.view === VSCODE_SIDEBAR && entry.collapsed === "true"),
  bottomRestored: reloaded.bottom !== null && near(reloaded.bottom?.h, BAR_HEIGHT, 6),
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
