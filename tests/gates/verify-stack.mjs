/**
 * Verification of **stacked regions** — prac's own composition. The first two views are prac's
 * (`dsh:*`); the third uses the app's real outline view so the untouched-row and folded-middle
 * scenarios have a third registered view.
 *
 * The point is that prac groups views itself (the workbench's view container is
 * a *higher form*, not the unit):
 *
 *  1. **bare by default** — the default arrangement shows one visible view in
 *     `left`, inside the container child that holds it, and that child must render
 *     exactly as it did before stacking existed (no headers, no extra chrome) —
 *     otherwise this is a redesign of the default layout rather than a capability;
 *  2. **stacked when there are two** — a second visible view in the same region
 *     stacks with headers, both bodies have height, and the region still paints;
 *  3. **fold** — folding one view keeps its header, drops its body and hands the
 *     space to the neighbour, both through the layout face and through a real
 *     click on the header.
 *
 * Since the container layer, `left` **selects among** named children (one per
 * borrowed container, plus one for prac's own sidebar), so the stack lives in the
 * child that holds the views — the gate discovers that child rather than assuming
 * the top-level region holds views directly. It also asserts the container bar
 * that the layer introduced.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:stack
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

/** The two views the stack gets (both prac's). */
const BASE_VIEW = "dsh:sidebar";
const ADDED_VIEW = "dsh:main:conversation";
/**
 * A third view for the folded-middle and untouched-row scenarios. The DSH right bar is kept hidden
 * by the compat shim, so use the app's real outline view instead (the stack accepts any registered
 * view id; the row is what this gate drives).
 */
const THIRD_VIEW = "vscode:view:outline";
/** The top-level region whose active child is the stack's home. */
const OUTER_REGION = "left";

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);
await page.waitForTimeout(1500);

/** The region the default arrangement actually shows views in. */
const REGION = await page.evaluate((outer) => {
  // The child that shows views may be a plain region **or** a `column` split (a stack takes the
  // region's place and keeps its id), so both kinds count.
  const child = document.querySelector(
    `[data-prac-region="${outer}"] > [data-prac-region], [data-prac-region="${outer}"] > [data-prac-split]`,
  );
  return child?.getAttribute("data-prac-region") ?? child?.getAttribute("data-prac-split") ?? outer;
}, OUTER_REGION);

/** The stack entries of the region, with their boxes and fold state. */
async function sample() {
  const facts = await page.evaluate((region) => {
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
    // The region that holds the rows may be a plain region or the `column` split that took its
    // place (a stack), so both elements answer to the id.
    const host =
      document.querySelector(`[data-prac-region="${region}"]`) ??
      document.querySelector(`[data-prac-split="${region}"]`);
    const bar = document.querySelector('[data-prac-container-bar="left"]');
    return {
      region: box(host),
      entries: [...(host?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map((entry) => ({
        view: entry.getAttribute("data-prac-stack-entry"),
        row: entry.getAttribute("data-prac-stack-row"),
        collapsed: entry.getAttribute("data-prac-stack-collapsed") === "true",
        // `handle="false"` only for `Disabled` (B4): the last row has no boundary, and a wholly
        // folded side has nothing to trade. `AtMinimum`/`AtMaximum` keep the handle and a directional
        // cursor; the state attribute is what tells them apart.
        handle: entry.getAttribute("data-prac-stack-handle"),
        sash: entry.getAttribute("data-prac-stack-sash-state"),
        entry: box(entry),
        header: box(entry.querySelector("[data-prac-stack-toggle]")),
        body: box(entry.querySelector("[data-prac-stack-body]")),
      })),
      sashes: [...(host?.querySelectorAll("[data-prac-sash]") ?? [])].map((sash) => ({
        left: sash.getAttribute("data-prac-sash-left"),
        right: sash.getAttribute("data-prac-sash-right"),
        dir: sash.getAttribute("data-prac-sash-dir"),
        state: sash.getAttribute("data-prac-stack-sash-state"),
        background: getComputedStyle(sash).backgroundColor,
        box: box(sash),
      })),
      containers: [...(bar?.querySelectorAll("[data-prac-container]") ?? [])].map((item) => ({
        id: item.getAttribute("data-prac-container"),
        active: item.getAttribute("data-prac-container-active") === "true",
        label: (item.textContent || "").trim(),
      })),
    };
  }, REGION);
  facts.distinctColours = await distinctColours(page, facts.region);
  return facts;
}

/** A one-move drag: the fast path that used to lose the pointer/up pair. */
async function dragQuick(box, dy) {
  if (!box) throw new Error("no sash box for the quick drag");
  const x = Math.round(box.x + box.w / 2);
  const y = Math.round(box.y + box.h / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy);
  await page.mouse.up();
  await page.waitForTimeout(700);
}

const initial = await sample();

// A second visible view in the same region: the stack appears. It is the
// conversation, not `dsh:rightbar`: DSH's own sidebar-right plugin keeps that
// one hidden through the compat shim, so it is not a view this gate owns.
await page.evaluate(({ region, view }) => globalThis.__pracLayout.place(view, region), {
  region: REGION,
  view: ADDED_VIEW,
});
await page.waitForSelector(
  `[data-prac-region="${REGION}"] [data-prac-stack-entry="${ADDED_VIEW}"], [data-prac-split="${REGION}"] [data-prac-stack-entry="${ADDED_VIEW}"]`,
  { timeout: 60_000 },
);
await page.waitForTimeout(2000);
const stacked = await sample();

// Hover is the only time the sash paints: the overlay is transparent by default.
const firstSash = stacked.sashes[0];
if (firstSash?.box) {
  await page.mouse.move(
    Math.round(firstSash.box.x + firstSash.box.w / 2),
    Math.round(firstSash.box.y + firstSash.box.h / 2),
  );
  await page.waitForTimeout(250);
}
const hovered = await sample();

// Fold through the face; then unfold through a real click on the header.
await page.evaluate((view) => globalThis.__pracLayout.setViewCollapsed(view, true), ADDED_VIEW);
await page.waitForTimeout(600);
const folded = await sample();

await page.click(`[data-prac-stack-toggle="${BASE_VIEW}"]`);
await page.waitForTimeout(600);
const clicked = await sample();

// ── 5. folded shut: nothing left to trade, and the room stays blank (B4/H3) ──
await page.evaluate(
  (views) => {
    for (const view of views) globalThis.__pracLayout.setViewCollapsed(view, true);
  },
  [BASE_VIEW, ADDED_VIEW],
);
await page.waitForTimeout(900);
const shut = await sample();

await page.evaluate(
  (views) => {
    for (const view of views) globalThis.__pracLayout.setViewCollapsed(view, false);
  },
  [BASE_VIEW, ADDED_VIEW],
);
await page.waitForTimeout(900);
const opened = await sample();

// ── 6. Alt drags the boundary without folding anything (B6) ──────────────────
const beforeAlt = await sample();
const altPoint = await page.evaluate((view) => {
  const host = document.querySelector(`[data-prac-stack-entry="${view}"]`);
  const rect = host?.getBoundingClientRect();
  return rect ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.bottom - 2) } : null;
}, BASE_VIEW);
if (altPoint !== null) {
  await page.keyboard.down("Alt");
  await page.mouse.move(altPoint.x, altPoint.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(altPoint.x, altPoint.y - (90 * step) / 8, { steps: 1 });
  }
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(800);
}
const afterAlt = await sample();

// ── 7. the region grows: **one** row takes it, the others stay (C6/C8) ───────
await page.setViewportSize({ width: 1600, height: 1200 });
await page.waitForTimeout(1000);
const grown = await sample();

// ── 8. third open row: one-step drag, untouched row stays put ───────────────
await page.evaluate(({ region, view }) => globalThis.__pracLayout.place(view, region), {
  region: REGION,
  view: THIRD_VIEW,
});
await page.waitForSelector(
  `[data-prac-region="${REGION}"] [data-prac-stack-entry="${THIRD_VIEW}"], [data-prac-split="${REGION}"] [data-prac-stack-entry="${THIRD_VIEW}"]`,
  { timeout: 60_000 },
);
await page.waitForTimeout(1200);
const third = await sample();
const quickSash = third.sashes[0];
if (quickSash?.box) await dragQuick(quickSash.box, -60);
const afterQuick = await sample();

// ── 9. fold the middle row, then drag the sash below it ─────────────────────
await page.evaluate((view) => globalThis.__pracLayout.setViewCollapsed(view, true), ADDED_VIEW);
await page.waitForTimeout(600);
const foldedMiddle = await sample();
const addedRow = foldedMiddle.entries.find((entry) => entry.view === ADDED_VIEW)?.row;
const middleSash = foldedMiddle.sashes.find((sash) => sash.left === addedRow);
if (middleSash?.box) await dragQuick(middleSash.box, -60);
const adjacent = await sample();

await close();

const entryOf = (facts, view) => facts.entries.find((entry) => entry.view === view) ?? null;
const bodyHeight = (facts, view) => entryOf(facts, view)?.body?.h ?? 0;

// Decision 21: whether a region *is* a stack (`isStacked`: a stack region with
// two visible views, and not one with one) is a unit test. What stays here is the
// rendering of that decision — headers appear, bodies have height, folding keeps
// the header and hands the space over, and a click on the header toggles.
const heightOf = (facts, view) => facts.entries.find((entry) => entry.view === view)?.entry?.h ?? 0;
const sumOf = (facts) => facts.entries.reduce((total, entry) => total + (entry.entry?.h ?? 0), 0);
const openIn = (facts) => facts.entries.filter((entry) => entry.collapsed !== true).length;
const near = (a, b, tolerance = 6) => Math.abs(a - b) <= tolerance;

const checks = {
  // 1. The default layout is untouched: one visible view, no headers.
  defaultIsBare: initial.entries.length === 0,
  // 1b. The container layer's own chrome is there: named children, one active.
  containerBarNamed:
    initial.containers.length > 1 &&
    initial.containers.filter((item) => item.active).length === 1 &&
    initial.containers.every((item) => item.label.length > 0) &&
    initial.containers.some((item) => item.active && item.id === REGION),
  // 2. Two visible views stack, in distinct bands, each with a header and a body.
  stackedRendersBoth:
    stacked.entries.length === 2 &&
    entryOf(stacked, BASE_VIEW) !== null &&
    entryOf(stacked, ADDED_VIEW) !== null &&
    (entryOf(stacked, BASE_VIEW)?.entry?.y ?? 0) !==
      (entryOf(stacked, ADDED_VIEW)?.entry?.y ?? 0) &&
    bodyHeight(stacked, BASE_VIEW) > 40 &&
    bodyHeight(stacked, ADDED_VIEW) > 40,
  stackedPainted: stacked.distinctColours > 4,
  // The first row's boundary is draggable (`Enabled`/one-way), and the last row's is `Disabled`
  // (B2/B4/B7). `handle` alone cannot tell the one-way states from `Enabled`; the state attribute can.
  boundariesFollowTheRows:
    stacked.entries.length === 2 &&
    stacked.entries[0]?.handle === "true" &&
    stacked.entries[0]?.sash !== "disabled" &&
    stacked.entries[1]?.handle === "false" &&
    stacked.entries[1]?.sash === "disabled",
  // 3. Folding keeps the header, drops the body, and gives the space away.
  foldKeepsHeaderDropsBody:
    entryOf(folded, ADDED_VIEW)?.collapsed === true &&
    (entryOf(folded, ADDED_VIEW)?.header?.h ?? 0) > 0 &&
    bodyHeight(folded, ADDED_VIEW) <= 2 &&
    bodyHeight(folded, BASE_VIEW) > bodyHeight(stacked, BASE_VIEW),
  // 4. The header itself toggles (the UI path, not just the face).
  // 5. Folded shut: every boundary is dead, and the stack does not pretend to fill itself.
  aShutStackHasNoUsableBoundary:
    shut.entries.length > 0 &&
    shut.entries.every((entry) => entry.handle === "false" && entry.sash === "disabled"),
  aShutStackLeavesItsRoomBlank: sumOf(shut) + 40 < (shut.region?.h ?? 0),
  // 6. Alt is a plain resize: the drag moves the boundary and folds nothing.
  altDragFoldsNothing:
    afterAlt.entries.length === beforeAlt.entries.length &&
    openIn(afterAlt) === openIn(beforeAlt) &&
    afterAlt.entries.every((entry) => entry.collapsed === false),
  // 7. The region grew: the rows share it by their proportions (C8), not one row taking all.
  // Compare with `afterAlt`: the Alt drag has already changed the two rows, so `beforeAlt` is not
  // the state the growth starts from.
  bothRowsShareTheGrowth: (() => {
    const gains = grown.entries.map((entry) => {
      const before = afterAlt.entries.find((old) => old.view === entry.view)?.entry?.h ?? 0;
      return (entry.entry?.h ?? 0) - before;
    });
    const shared = gains.filter((gain) => gain > 20).length >= 2;
    return shared && gains.every((gain) => gain >= -2);
  })(),
  clickToggles:
    entryOf(clicked, BASE_VIEW)?.collapsed === true && bodyHeight(clicked, BASE_VIEW) <= 2,
  // 8. Fold then unfold restores the drawn height, through both paths the note names: the header
  // click (BASE_VIEW) and the face (ADDED_VIEW, folded above). E1/E2.
  unfoldRestoresTheHeight:
    near(heightOf(opened, BASE_VIEW), heightOf(stacked, BASE_VIEW)) &&
    near(heightOf(opened, ADDED_VIEW), heightOf(stacked, ADDED_VIEW)),
  // 9. The sash is a 4px overlay, not a flex gap: the rows touch, the strip is 4px, and it is
  // transparent until hovered.
  sashIsAnOverlayWithoutAGap:
    stacked.sashes.length > 0 &&
    near(
      (stacked.entries[0]?.entry?.y ?? 0) + (stacked.entries[0]?.entry?.h ?? 0),
      stacked.entries[1]?.entry?.y ?? 0,
      1,
    ) &&
    near(stacked.sashes[0]?.box?.h ?? 0, 4, 1) &&
    stacked.sashes[0]?.background === "rgba(0, 0, 0, 0)",
  sashAppearsOnHover:
    hovered.sashes[0]?.background !== "rgba(0, 0, 0, 0)" &&
    hovered.sashes[0]?.background !== stacked.sashes[0]?.background,
  // 10. A one-move drag still works, and the third row is not dragged along by proportional
  // re-fitting (the seed keeps its claim equal to what is drawn).
  quickDragMoves:
    openIn(afterQuick) === 3 &&
    Math.abs(heightOf(afterQuick, BASE_VIEW) - heightOf(third, BASE_VIEW)) > 10,
  untouchedThirdRowDoesNotBounce: near(
    heightOf(afterQuick, THIRD_VIEW),
    heightOf(third, THIRD_VIEW),
    2,
  ),
  // 11. The middle row is folded; the sash below it still resizes the open rows on both sides and
  // leaves the folded header at its 20px.
  foldedMiddleStillDrags:
    entryOf(adjacent, ADDED_VIEW)?.collapsed === true &&
    near(heightOf(adjacent, ADDED_VIEW), 20, 2) &&
    Math.abs(heightOf(adjacent, BASE_VIEW) - heightOf(foldedMiddle, BASE_VIEW)) > 10 &&
    Math.abs(heightOf(adjacent, THIRD_VIEW) - heightOf(foldedMiddle, THIRD_VIEW)) > 10 &&
    openIn(adjacent) === 2,
  // Only this feature's own failures; the page's known noise is not ours.
  noErrors: own("__pracLayout").length === 0 && own("prac-client-ui-layout").length === 0,
};

report({
  url,
  facts: {
    region: REGION,
    initial,
    stacked,
    folded,
    clicked,
    shut,
    opened,
    beforeAlt,
    afterAlt,
    grown,
    hovered,
    third,
    afterQuick,
    foldedMiddle,
    adjacent,
    consoleErrors,
  },
  checks,
  ok: "OK: one view renders bare, two stack with headers, the sash is a 4px hover-only overlay, folding keeps the header, one-step drags work, the folded middle stays draggable, and an untouched third row does not bounce.",
});
