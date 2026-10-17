/**
 * Verification of **stacked regions** — prac's own composition, so the views it
 * stacks are prac's own (`dsh:*`): this gate needs no VS Code side at all.
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
  bothRowsShareTheGrowth: (() => {
    const gains = grown.entries.map((entry) => {
      const before = beforeAlt.entries.find((old) => old.view === entry.view)?.entry?.h ?? 0;
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
    consoleErrors,
  },
  checks,
  ok: "OK: one view renders bare, two stack with headers, folding keeps the header and hands the space over, and the header toggles on click.",
});
