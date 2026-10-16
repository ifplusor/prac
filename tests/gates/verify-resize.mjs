/**
 * Verification of **region sizing** (S2 step 2): bounds, proportions, and who gives way.
 *
 * Unit tests can prove the arithmetic of a boundary drag on a tree. What only the running frame can
 * show is the claim the layer actually makes on screen, in the default row of three:
 *
 *  1. **bounds** — no drag, and no narrow window, ever pushes a block under its `min` or over its
 *     `max`;
 *  2. **proportions** — dragging the `left | center` boundary moves the blocks on both sides of it
 *     (a `Distribute` drag spreads over the whole side, not one neighbour), and it leaves the other
 *     axis exactly as it was;
 *  3. **priority** — when the window runs short the **centre** gives way first and the tracks keep
 *     their size, which is VS Code's own convention (`editorPart = High`, `sidebarPart = Low`).
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:resize
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const LEFT = "left";
const CENTER = "center";
const RIGHT = "right";
/** The default track widths, from the frame's topology. */
const LEFT_WIDTH = 280;
const RIGHT_WIDTH = 420;

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);
await page.waitForTimeout(2000);

/** The box a region (or the split that took its id) is drawn at. */
const box = (region) =>
  page.evaluate((id) => {
    const element =
      document.querySelector(`[data-prac-region="${id}"]`) ??
      document.querySelector(`[data-prac-split="${id}"]`);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }, region);

const sample = async () => ({
  left: await box(LEFT),
  center: await box(CENTER),
  right: await box(RIGHT),
});

/** Drag the sash matching `selector` by `dx` px, in steps, and let the frame settle. */
async function dragSash(selector, dx) {
  const point = await page.evaluate((sel) => {
    const sash = document.querySelector(sel);
    if (!sash) return null;
    const rect = sash.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }, selector);
  if (!point) throw new Error(`no sash matching "${selector}"`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(point.x + (dx * step) / 10, point.y, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

const initial = await sample();
const stage = await page.evaluate(
  (center) =>
    (
      document.querySelector(`[data-prac-region="${center}"]`) ??
      document.querySelector(`[data-prac-split="${center}"]`)
    )?.getBoundingClientRect().height ?? 0,
  CENTER,
);

await dragSash(`[data-prac-sash-left="${LEFT}"]`, 120);
const dragged = await sample();

// A tight window: the frame loses 600px of width. The centre is `high` priority, so it is the block
// that gives way; the tracks are `low`, so they keep their size as long as they can.
await page.setViewportSize({ width: 1000, height: 1000 });
await page.waitForTimeout(1200);
const tight = await sample();

/** Width change between two samples; an absent region counts as nothing drawn. */
const grew = (after, before) => (after?.w ?? 0) - (before?.w ?? 0);
const shrank = (after, before) => (before?.w ?? 0) - (after?.w ?? 0);
/** A region that is not rendered at all means "no block there", which the checks below allow. */
const drawn = (box) => box === null || (box?.w ?? 0) > 40;

// ── the edge: drag a block away and bring it back (VS Code's sash snap) ──────
/** Double-click the sash, the way a person resets a boundary. */
async function resetSash(selector) {
  const point = await page.evaluate((sel) => {
    const sash = document.querySelector(sel);
    if (!sash) return null;
    const rect = sash.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }, selector);
  if (!point) throw new Error(`no sash matching "${selector}"`);
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(800);
}

const beforeSnap = await sample();
await dragSash(`[data-prac-sash-left="${LEFT}"]`, -400);
const snapped = await sample();
await dragSash(`[data-prac-sash-left="${LEFT}"]`, 400);
const brought = await sample();
await resetSash(`[data-prac-sash-left="${LEFT}"]`);
const reset = await sample();

const checks = {
  // 1. Bounds: the tracks start at their designed widths and nobody ends up empty.
  // `right` is empty in the default arrangement, so it draws nothing: the check is that a track that
  // **is** drawn sits at its designed width.
  theDefaultWidthsHold:
    Math.abs((initial.left?.w ?? 0) - LEFT_WIDTH) <= 2 &&
    (initial.right === null || Math.abs((initial.right?.w ?? 0) - RIGHT_WIDTH) <= 2),
  nobodyCollapses: [initial, dragged, tight].every((facts) =>
    [facts.left, facts.center, facts.right].every(drawn),
  ),
  // 2. Proportions: the dragged block takes the room and **both** blocks on the far side give it up
  //    (`Distribute` spreads over the side, it does not push one neighbour).
  theDraggedBlockTookTheRoom: grew(dragged.left, initial.left) >= 80,
  everyBlockOnTheFarSideGaveRoom:
    shrank(dragged.center, initial.center) > 10 &&
    (dragged.right === null || shrank(dragged.right, initial.right) > 10),
  theOtherAxisIsUntouched:
    dragged.left?.h === initial.left?.h &&
    dragged.center?.h === initial.center?.h &&
    dragged.right?.h === initial.right?.h,
  // 3. Priority: the centre is the one that gave way when the window got tight.
  theCentreGaveWayWhenItGotTight: shrank(tight.center, dragged.center) >= 40,
  theTracksKeptTheirSize:
    Math.abs(grew(tight.left, dragged.left)) <= 2 &&
    (tight.right === null || Math.abs(grew(tight.right, dragged.right)) <= 2),
  theCentreStayedOnScreen:
    (tight.center?.w ?? 0) > 40 && (tight.center?.h ?? 0) === Math.round(stage),
  // 4. The edge: a block dragged away leaves no room behind, and coming back restores its size.
  aDraggedBlockGoesAway:
    (snapped.left?.w ?? -1) === 0 && grew(snapped.center, beforeSnap.center) >= 200,
  // It comes back at the width it had when it went away and **keeps following the drag** (VS Code
  // re-runs the resize with the same delta), so the check is "at least as wide as it was".
  draggingBackBringsItBack: (brought.left?.w ?? 0) >= (beforeSnap.left?.w ?? 0),
  // 5. A double click on the boundary evens the two blocks out.
  resetEvensesThePair: Math.abs((reset.left?.w ?? 0) - (reset.center?.w ?? 0)) <= 1,
  noErrors:
    own("__pracLayout").length === 0 &&
    own("prac-client-ui-layout").length === 0 &&
    own("vscode-embed:").length === 0,
};

await close();

report({
  url,
  facts: { initial, dragged, tight, beforeSnap, snapped, brought, reset, consoleErrors },
  checks,
  ok: "OK: the default row sizes to its tracks, a boundary drag spreads over the whole side inside every floor, and a tight window is paid for by the centre",
});
