/**
 * Verification of the **bottom bar**: a region under the whole row, where a
 * terminal / output / problems belong, and which costs the default layout
 * nothing while it is empty.
 *
 *  1. **absent while empty** — the default arrangement puts nothing there, and an
 *     empty region is not rendered, so the page's region list is exactly the row
 *     (this is what keeps the bottom bar a capability instead of a redesign);
 *  2. **appears when filled** — a view placed there renders at the bar's size,
 *     spans the frame, sits at the bottom, and paints;
 *  3. **the row gives room** — the row above shrinks by the bar's height, and
 *     collapsing the bar hands the room back.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:bottom
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

const BOTTOM = "bottom";
const STAGE = "stage";
/** A prac view with content, used to fill the bar. */
const VIEW = "dsh:main:conversation";

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);
await page.waitForTimeout(1500);

async function sample() {
  const facts = await page.evaluate(
    ({ bottom, stage }) => {
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
      return {
        frame: box("[data-prac-frame]"),
        bottom: box(`[data-prac-region="${bottom}"]`),
        stage: box(`[data-prac-region="${stage}"]`),
        regions: [...document.querySelectorAll("[data-prac-region]")].map((element) =>
          element.getAttribute("data-prac-region"),
        ),
        // The view inside the bar, to prove the region is not an empty shell.
        viewHosts: [...document.querySelectorAll(`[data-prac-region="${bottom}"] *`)].length,
      };
    },
    { bottom: BOTTOM, stage: STAGE },
  );
  facts.distinctColours = await distinctColours(page, facts.bottom);
  return facts;
}

const initial = await sample();

// Fill the bar: place the view, then open the region.
await page.evaluate(
  ({ bottom, view }) => {
    globalThis.__pracLayout.place(view, bottom);
    globalThis.__pracLayout.setCollapsed(bottom, false);
  },
  { bottom: BOTTOM, view: VIEW },
);
await page.waitForTimeout(1500);
const opened = await sample();

// Collapse it again: the row takes the room back.
await page.evaluate((bottom) => globalThis.__pracLayout.setCollapsed(bottom, true), BOTTOM);
await page.waitForTimeout(800);
const collapsed = await sample();

await close();

const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;

// Decision 21: the arithmetic (an empty fixed region is absent; the row's extent
// minus the bar's; `cachedSize` round-trip) is a unit test. What stays here is
// that real CSS agrees with it — the bar is at the bottom, as wide as the frame,
// at its size, with pixels — and that collapsing it hands the room back.
const checks = {
  // 1. Empty means absent: the default page is exactly the row.
  // No file is open, so the right track holds nothing and is not rendered: the
  // factory arrangement is the sidebar plus the centre (decision 17 retired the
  // editor part, so an empty track no longer has an occupant keeping it alive).
  absentWhileEmpty: initial.bottom === null && initial.regions.join(",") === "left,stage",
  // 2. Filled: at the bottom, full width, at the bar's size, with pixels.
  appearsAtTheBottom:
    opened.bottom !== null &&
    near(opened.bottom?.w, opened.frame?.w, 2) &&
    near((opened.bottom?.y ?? 0) + (opened.bottom?.h ?? 0), opened.frame?.h, 2) &&
    (opened.bottom?.h ?? 0) >= 200 &&
    (opened.bottom?.h ?? 0) <= 260,
  bottomPainted: opened.distinctColours > 4,
  // 3. The row above gives the room, and gets it back on collapse.
  rowGivesRoom: (opened.stage?.h ?? 0) < (initial.stage?.h ?? 0) - 100,
  collapseReturnsRoom:
    (collapsed.bottom?.h ?? 0) <= 2 && near(collapsed.stage?.h, initial.stage?.h, 8),
  // Only this feature's own failures; the page's known noise is not ours.
  noErrors:
    own("__pracLayout").length === 0 &&
    own("prac-client-ui-layout").length === 0 &&
    own("vscode-embed:").length === 0,
};

report({
  url,
  facts: { initial, opened, collapsed, consoleErrors },
  checks,
  ok: "OK: the bottom bar is absent while empty, spans the frame when filled, takes its room from the row above, and gives it back when collapsed.",
});
