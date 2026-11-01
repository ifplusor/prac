/**
 * Verification of the **bottom bar**: a region under the whole row, where a
 * terminal / output / problems belong, and which costs the default layout
 * nothing while it is empty.
 *
 *  1. **absent while empty** — nothing visible there means the region is not
 *     rendered, so the frame is exactly the row (this is what keeps the bottom
 *     bar a capability instead of a redesign). The catalogue now **fills** the bar
 *     with the app's panel containers by default, so the gate empties it first:
 *     "empty" is a state to reach, not the factory arrangement;
 *  2. **appears when filled** — a view placed there renders at the bar's size,
 *     spans the frame, sits at the bottom, and paints;
 *  3. **the row gives room** — the row above shrinks by the bar's height, and
 *     collapsing the bar hands the room back.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:bottom
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

const BOTTOM = "bottom";
const CENTER = "center";
/** A prac view with content, used to fill the bar. */
const VIEW = "dsh:main:conversation";

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);
await page.waitForTimeout(1500);

// Make the bar empty: the arrangement put the app's panel containers there, so
// wait for that to have happened (the app boots after the frame) and then hide
// everything it placed — the region and its container children.
await page.waitForFunction(
  (bottom) =>
    Object.values(globalThis.__pracFrame.getState().views).some((record) =>
      (record.region ?? "").startsWith(`${bottom}/`),
    ),
  BOTTOM,
  { timeout: 90_000 },
);

/**
 * Hide every view the arrangement put in the bottom track, and wait for the bar to
 * actually be gone.
 *
 * Looped rather than done once: the view catalogue keeps growing after the page
 * settles (extensions activate late — more so since the workbench reaches its
 * `Eventually` phase), and a view arriving between the hiding and the sampling
 * puts the bar back. What the gate asserts is "an empty bar is absent", so it
 * waits for that state instead of assuming the first hide was final.
 *
 * @returns whether the bar went away.
 */
async function emptyTheBar() {
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.evaluate((bottom) => {
      // A container's surface is a board window record; the widget views live on the
      // board, so emptying the bar means hiding the records the frame actually has.
      for (const [id, record] of Object.entries(globalThis.__pracFrame.getState().views)) {
        const region = record.region ?? "";
        if (region === bottom || region.startsWith(`${bottom}/`)) {
          globalThis.__pracFrame.hide(id);
        }
      }
    }, BOTTOM);
    await page.waitForTimeout(500);
    const present = await page.evaluate(
      (bottom) => document.querySelector(`[data-prac-region="${bottom}"]`) !== null,
      BOTTOM,
    );
    if (!present) return true;
  }
  return false;
}

const emptied = await emptyTheBar();

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
        tabs: [...document.querySelectorAll(`[data-prac-container-bar="${bottom}"] button`)].map(
          (tab) => ({
            label: (tab.textContent ?? "").trim(),
            role: tab.getAttribute("role"),
            selected: tab.getAttribute("aria-selected"),
          }),
        ),
        tablist: document
          .querySelector(`[data-prac-container-bar="${bottom}"]`)
          ?.getAttribute("role"),
        toggle: document.querySelector("[data-prac-bottom-toggle]") !== null,
        togglePressed: document
          .querySelector("[data-prac-bottom-toggle]")
          ?.getAttribute("aria-pressed"),
      };
    },
    { bottom: BOTTOM, stage: CENTER },
  );
  facts.distinctColours = await distinctColours(page, facts.bottom);
  return facts;
}

const initial = await sample();

// Fill the bar: place the view, then open the region.
await page.evaluate(
  ({ bottom, view }) => {
    globalThis.__pracFrame.place(view, bottom);
    globalThis.__pracFrame.setCollapsed(bottom, false);
  },
  { bottom: BOTTOM, view: VIEW },
);
await page.waitForTimeout(1500);
const opened = await sample();

// Ctrl/Cmd+J toggles it without the pointer.
await page.keyboard.press("Control+J");
await page.waitForTimeout(800);
const shortcutClosed = await sample();
await page.keyboard.press("Control+J");
await page.waitForTimeout(800);
const shortcutOpen = await sample();

// Collapse it again: the row takes the room back.
await page.evaluate((bottom) => globalThis.__pracFrame.setCollapsed(bottom, true), BOTTOM);
await page.waitForTimeout(800);
const collapsed = await sample();

await close();

const near = (a, b, tolerance) => Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;

// Decision 21: the arithmetic (an empty fixed region is absent; the row's extent
// minus the bar's; `cachedSize` round-trip) is a unit test. What stays here is
// that real CSS agrees with it — the bar is at the bottom, as wide as the frame,
// at its size, with pixels — and that collapsing it hands the room back.
const checks = {
  // 1. Empty means absent: the frame is exactly the row.
  // No file is open, so the right track holds nothing and is not rendered: the
  // factory arrangement is the sidebar plus the centre (decision 17 retired the
  // editor part, so an empty track no longer has an occupant keeping it alive).
  // The bar's container children are still in the tree, but nothing in them is
  // visible, so neither they nor the bar are rendered.
  // The setup has to have reached the empty state at all: a view arriving in the
  // track after the hiding would make the three checks below measure the wrong
  // thing, and this names that instead of blaming the frame.
  barEmptied: emptied,
  absentWhileEmpty:
    initial.bottom === null &&
    initial.regions.filter((region) => !region.includes("/")).join(",") === "left,center",
  // 2. Filled: at the bottom, full width, at the bar's size, with pixels.
  appearsAtTheBottom:
    opened.bottom !== null &&
    near(opened.bottom?.w, opened.frame?.w, 60) &&
    near((opened.bottom?.y ?? 0) + (opened.bottom?.h ?? 0), opened.frame?.h, 2) &&
    (opened.bottom?.h ?? 0) >= 200 &&
    (opened.bottom?.h ?? 0) <= 260,
  bottomPainted: opened.distinctColours > 4,
  // 3. The row above gives the room, and gets it back on collapse.
  rowGivesRoom: (opened.stage?.h ?? 0) < (initial.stage?.h ?? 0) - 100,
  shortcutToggles: (shortcutClosed.bottom?.h ?? 999) <= 2 && (shortcutOpen.bottom?.h ?? 0) >= 200,
  collapseReturnsRoom:
    (collapsed.bottom?.h ?? 0) <= 2 && near(collapsed.stage?.h, initial.stage?.h, 8),
  // Only this feature's own failures; the page's known noise is not ours.
  noErrors:
    own("__pracFrame").length === 0 &&
    own("prac-client-ui-frame").length === 0 &&
    own("vscode-embed:").length === 0,
};

report({
  url,
  facts: { emptied, initial, opened, shortcutClosed, shortcutOpen, collapsed, consoleErrors },
  checks,
  ok: "OK: the bottom bar is absent while empty, spans the frame when filled, takes its room from the row above, and gives it back when collapsed.",
});
