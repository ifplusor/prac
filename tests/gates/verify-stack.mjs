/**
 * Verification of **stacked regions** — prac's own composition, so the views it
 * stacks are prac's own (`dsh:*`): this gate needs no VS Code side at all.
 *
 * The point is that prac groups views itself (the workbench's view container is
 * a *higher form*, not the unit):
 *
 *  1. **bare by default** — the default arrangement puts one visible view in
 *     `left`, and that region must render exactly as it did before stacking
 *     existed (no headers, no extra chrome) — otherwise this is a redesign of
 *     the default layout rather than a capability;
 *  2. **stacked when there are two** — a second visible view in the same region
 *     stacks with headers, both bodies have height, and the region still paints;
 *  3. **fold** — folding one view keeps its header, drops its body and hands the
 *     space to the neighbour, both through the layout face and through a real
 *     click on the header.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' pnpm verify:stack
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

/** The region that stacks, and the two views it gets (both prac's). */
const REGION = "left";
const BASE_VIEW = "dsh:sidebar";
const ADDED_VIEW = "dsh:main:conversation";

const url = requireUrl();
const { page, own, consoleErrors, close } = await openPrac(url);
await page.waitForTimeout(1500);

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
    const host = document.querySelector(`[data-prac-region="${region}"]`);
    return {
      region: box(host),
      entries: [...(host?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map((entry) => ({
        view: entry.getAttribute("data-prac-stack-entry"),
        collapsed: entry.getAttribute("data-prac-stack-collapsed") === "true",
        entry: box(entry),
        header: box(entry.querySelector("[data-prac-stack-toggle]")),
        body: box(entry.querySelector("[data-prac-stack-body]")),
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
  `[data-prac-region="${REGION}"] [data-prac-stack-entry="${ADDED_VIEW}"]`,
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

await close();

const entryOf = (facts, view) => facts.entries.find((entry) => entry.view === view) ?? null;
const bodyHeight = (facts, view) => entryOf(facts, view)?.body?.h ?? 0;

const checks = {
  // 1. The default layout is untouched: one visible view, no headers.
  defaultIsBare: initial.entries.length === 0,
  // 2. Two visible views stack, in distinct bands, each with a header and a body.
  stackedHasBoth:
    stacked.entries.length === 2 &&
    entryOf(stacked, BASE_VIEW) !== null &&
    entryOf(stacked, ADDED_VIEW) !== null,
  stackedDistinctBands:
    (entryOf(stacked, BASE_VIEW)?.entry?.y ?? 0) !==
      (entryOf(stacked, ADDED_VIEW)?.entry?.y ?? 0) &&
    (entryOf(stacked, BASE_VIEW)?.entry?.h ?? 0) > 0 &&
    (entryOf(stacked, ADDED_VIEW)?.entry?.h ?? 0) > 0,
  stackedBodies: bodyHeight(stacked, BASE_VIEW) > 40 && bodyHeight(stacked, ADDED_VIEW) > 40,
  stackedPainted: stacked.distinctColours > 4,
  // 3. Folding keeps the header, drops the body, and gives the space away.
  foldKeepsHeader:
    entryOf(folded, ADDED_VIEW)?.collapsed === true &&
    (entryOf(folded, ADDED_VIEW)?.header?.h ?? 0) > 0,
  foldDropsBody: bodyHeight(folded, ADDED_VIEW) <= 2,
  foldGrowsNeighbour: bodyHeight(folded, BASE_VIEW) > bodyHeight(stacked, BASE_VIEW),
  // 4. The header itself toggles (the UI path, not just the face).
  clickToggles:
    entryOf(clicked, BASE_VIEW)?.collapsed === true && bodyHeight(clicked, BASE_VIEW) <= 2,
  // Only this feature's own failures; the page's known noise is not ours.
  noErrors: own("__pracLayout").length === 0 && own("prac-client-ui-layout").length === 0,
};

report({
  url,
  facts: { region: REGION, initial, stacked, folded, clicked, consoleErrors },
  checks,
  ok: "OK: one view renders bare, two stack with headers, folding keeps the header and hands the space over, and the header toggles on click.",
});
