/**
 * The stack allocation, tested as the arithmetic it is.
 *
 * `allocateStack` turns the sizes people dragged and the folds they clicked into the heights a
 * stack draws. The gates cover the interactions end to end; these cover the rules themselves —
 * including "growing with nothing below takes room from above", which no gate could pin down
 * (a synthetic drag loses its last steps, so the amount it moves is not reproducible).
 *
 * It lives in `model.ts` because `frame.ts` pulls in the store/DOM and cannot be imported by a
 * unit test at all (measured: `Cannot find package 'zustand'`).
 */
import { describe, expect, it } from "vite-plus/test";
import type { LayoutState } from "./contract.js";
import {
  HEADER_HEIGHT,
  MIN_ENTRY,
  allocateStack,
  dragChainTarget,
  dragSnapTarget,
  redistributeOnDrag,
  setViewCollapsed,
  moveViewInRegion,
  visibleViews,
} from "./model.js";

const HEIGHT = 734;

/** A state with just the view records `allocateStack` reads. */
const stateOf = (
  views: Record<string, { size?: number; collapsed?: boolean; max?: number; cachedSize?: number }>,
): LayoutState => ({ views }) as unknown as LayoutState;

const heights = (views: readonly string[], drawn: ReadonlyMap<string, number>): number[] =>
  views.map((viewId) => drawn.get(viewId) ?? 0);

describe("allocateStack", () => {
  it("shares the height equally when nobody has sized anything", () => {
    const views = ["a", "b", "c"];
    const drawn = allocateStack(views, stateOf({ a: {}, b: {}, c: {} }), new Map(), 300);
    expect(heights(views, drawn)).toEqual([100, 100, 100]);
  });

  it("keeps the sizes people set and lets the rest share what is left", () => {
    const views = ["a", "b", "c", "d"];
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 400 }, b: {}, c: {}, d: {} }),
      new Map(),
      HEIGHT,
    );
    // A size is a starting point, not a promise: room left over is shared in proportion, so a
    // sized entry can move by the rounding of its share (upstream relayouts proportionally too).
    expect(Math.abs((drawn.get("a") ?? 0) - 400)).toBeLessThanOrEqual(1);
    for (const viewId of ["b", "c", "d"]) {
      expect(drawn.get(viewId) ?? 0).toBeGreaterThanOrEqual(MIN_ENTRY);
    }
    expect(heights(views, drawn).reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(
      HEIGHT,
    );
  });

  it("scales sizes that cannot all fit, and never below the floor", () => {
    const views = ["a", "b", "c", "d", "e"];
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 600 }, b: { size: 600 }, c: {}, d: {}, e: {} }),
      new Map(),
      HEIGHT,
    );
    expect(drawn.get("a") ?? 0).toBeLessThan(600);
    expect(drawn.get("b") ?? 0).toBeLessThan(600);
    for (const viewId of views) {
      expect(drawn.get(viewId) ?? 0).toBeGreaterThanOrEqual(MIN_ENTRY);
    }
  });

  it("hands room left over to the rows that can take it, from the last one back", () => {
    const views = ["a", "b", "c", "d"];
    // 300 + 100 + 100 + 100 = 600 of the stack, so 134 is genuinely left over.
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 300 }, b: {}, c: {}, d: {} }),
      new Map([
        ["b", 100],
        ["c", 100],
        ["d", 100],
      ]),
      HEIGHT,
    );
    // Nobody declares a ceiling here, so the **last** capable row takes the whole remainder — the
    // order `distributeEmptySpace` walks in. It is not a proportional re-share.
    expect(drawn.get("a")).toBe(300);
    expect(drawn.get("b")).toBe(100);
    expect(drawn.get("c")).toBe(100);
    expect(drawn.get("d")).toBe(100 + (HEIGHT - 600));
    expect(heights(views, drawn).reduce((total, size) => total + size, 0)).toBe(HEIGHT);
  });

  it("stops at a declared ceiling and moves on to the next capable row", () => {
    const views = ["a", "b", "c"];
    const drawn = allocateStack(
      views,
      stateOf({ a: {}, b: {}, c: { max: 300 } }),
      new Map([
        ["a", 100],
        ["b", 100],
        ["c", 100],
      ]),
      HEIGHT,
    );
    // `c` walks up to its own ceiling; what is left goes to `b`, the next row back.
    expect(drawn.get("c")).toBe(300);
    expect(drawn.get("b")).toBe(HEIGHT - 400);
    expect(drawn.get("a")).toBe(100);
  });

  it("gives a fold's room to the rows that can take it, from the last one back", () => {
    const views = ["a", "b", "c"];
    const foldedLast = allocateStack(
      views,
      stateOf({ a: {}, b: {}, c: { collapsed: true } }),
      new Map([
        ["a", 40],
        ["b", 40],
      ]),
      HEIGHT,
    );
    const available = Math.max(2 * MIN_ENTRY, HEIGHT - HEADER_HEIGHT);
    // The folded row is a header and takes nothing; the room goes to `b` (the last row that can
    // still grow) — not in proportion to what the rows already hold.
    expect(foldedLast.get("c")).toBe(HEADER_HEIGHT);
    expect(foldedLast.get("b")).toBe(40 + (available - 80));
    expect(foldedLast.get("a")).toBe(40);
    // The folded row still holds its header line, so the stack's own height is `available` + it.
    expect(heights(views, foldedLast).reduce((total, size) => total + size, 0)).toBe(
      available + HEADER_HEIGHT,
    );
  });
});
describe("redistributeOnDrag (SplitView.resize, splitview.ts:1308-1325)", () => {
  const entries = (...rows: [number, boolean][]) =>
    rows.map(([height, folded], index) => ({ viewId: `v${index}`, height, folded }));

  it("takes the room from the entries below, nearest first", () => {
    const drawn = redistributeOnDrag(entries([100, false], [200, false], [300, false]), "v1", 300);
    expect(drawn.get("v1")).toBe(300);
    expect(drawn.get("v2")).toBe(200);
    // Not touched, so not handed back.
    expect(drawn.has("v0")).toBe(false);
  });

  it("hands back nothing at all when the entries below have nothing to give", () => {
    const drawn = redistributeOnDrag(entries([400, false], [48, false], [48, false]), "v1", 148);
    expect(drawn.size).toBe(0);
  });

  it("treats a folded entry below as a header: it gives no room and never moves", () => {
    const drawn = redistributeOnDrag(entries([400, false], [300, false], [20, true]), "v1", 340);
    expect(drawn.size).toBe(0);
  });

  it("still takes the room an unfolded entry further down can give", () => {
    const drawn = redistributeOnDrag(
      entries([400, false], [200, false], [20, true], [200, false]),
      "v1",
      260,
    );
    expect(drawn.get("v1")).toBe(260);
    expect(drawn.get("v3")).toBe(140);
    expect(drawn.has("v0")).toBe(false);
    expect(drawn.has("v2")).toBe(false);
  });

  it("hands a shrink to the entries below, and leaves the entries above alone", () => {
    const withBelow = redistributeOnDrag(
      entries([400, false], [300, false], [200, false]),
      "v1",
      200,
    );
    expect(withBelow.get("v1")).toBe(200);
    expect(withBelow.get("v2")).toBe(300);
    expect(withBelow.has("v0")).toBe(false);

    // The last sash has no entries below, so the room it frees is the allocator's to place
    // (upstream's `distributeEmptySpace`, `splitview.ts:1002`) — the entries above do not move.
    const lastEntry = redistributeOnDrag(entries([400, false], [300, false]), "v1", 200);
    expect(lastEntry.get("v1")).toBe(200);
    expect(lastEntry.has("v0")).toBe(false);
  });
});
describe("setViewCollapsed (SplitView.setVisible's cached size, splitview.ts:228)", () => {
  it("remembers what an unsized entry was drawn at, in its own field", () => {
    const state = stateOf({ a: {}, b: {} });
    const folded = setViewCollapsed(state, "a", true, 173);
    expect(folded.views.a?.collapsed).toBe(true);
    // A folded row is a header: `size` is not its height any more, the memory is separate.
    expect(folded.views.a?.size).toBeUndefined();
    expect(folded.views.a?.cachedSize).toBe(173);
    const opened = setViewCollapsed(folded, "a", false, 20);
    expect(opened.views.a?.size).toBe(173);
    expect(opened.views.a?.cachedSize).toBeUndefined();
  });

  it("remembers what the caller hands over, and falls back to the size it already had", () => {
    // The caller's value wins (SplitView: `_cachedVisibleSize = typeof size === 'number' ? size : this.size`).
    const told = setViewCollapsed(stateOf({ a: { size: 300 } }), "a", true, 173);
    expect(told.views.a?.cachedSize).toBe(173);
    expect(told.views.a?.size).toBeUndefined();
    // With nothing handed over, the height it already held is what it remembers.
    const fellBack = setViewCollapsed(stateOf({ a: { size: 300 } }), "a", true);
    expect(fellBack.views.a?.cachedSize).toBe(300);
    expect(fellBack.views.a?.size).toBeUndefined();
  });

  it("shares the height again when nothing was remembered", () => {
    // Showing reads the memory alone (splitview.ts:234); the measurement a folded row reports is its
    // header, so opening at that would leave a body of a few pixels.
    const opened = setViewCollapsed(stateOf({ a: { collapsed: true } }), "a", false, 147);
    expect(opened.views.a?.size).toBeUndefined();
  });

  it("lifts a header-sized memory to the floor when unfolding, and invents nothing without one", () => {
    const lifted = setViewCollapsed(
      stateOf({ a: { cachedSize: 18, collapsed: true } }),
      "a",
      false,
    );
    expect(lifted.views.a?.size).toBe(48);
    const unmeasured = setViewCollapsed(stateOf({ a: {} }), "a", true);
    expect(unmeasured.views.a?.size).toBeUndefined();
    expect(unmeasured.views.a?.cachedSize).toBeUndefined();
  });
});

describe("dragSnapTarget (SplitView's snap at half the minimum, splitview.ts:942/1301)", () => {
  const entries = (...rows: [number, boolean][]) =>
    rows.map(([height, folded], index) => ({ viewId: `v${index}`, height, folded }));

  it("folds the entry below once the drag squeezes it past half its floor", () => {
    expect(dragSnapTarget(entries([300, false], [48, false]), "v0", 30)).toEqual({
      viewId: "v1",
      collapsed: true,
    });
    // Still above the halfway point: nothing happens.
    expect(dragSnapTarget(entries([300, false], [48, false]), "v0", 10)).toBeUndefined();
  });

  it("never opens a folded entry by dragging (upstream has this off by default)", () => {
    // `IView.snap` is opt-in and nothing in the workbench opts in (splitview.ts:78-84), so a
    // collapsed entry waits for the fold toggle on its header rather than popping open.
    expect(dragSnapTarget(entries([300, false], [20, true]), "v0", 400)).toBeUndefined();
    expect(dragSnapTarget(entries([300, false], [20, true]), "v0", -200)).toBeUndefined();
  });

  it("folds the dragged entry itself when its own boundary goes under half its floor", () => {
    expect(dragSnapTarget(entries([300, false], [200, false]), "v0", -280)).toEqual({
      viewId: "v0",
      collapsed: true,
    });
    expect(dragSnapTarget(entries([300, false], [200, false]), "v0", -260)).toBeUndefined();
  });

  it("says nothing for the stack's last entry, which has no boundary", () => {
    expect(dragSnapTarget(entries([300, false]), "v0", 400)).toBeUndefined();
  });
});

describe("dragChainTarget (the folding chain, bottom-up)", () => {
  const entries = (...rows: [number, boolean][]) =>
    rows.map(([height, folded], index) => ({ viewId: `v${index}`, height, folded }));

  it("asks for the next entry below once the room there runs out", () => {
    // outline / timeline / open editors / file view / probe: dragging the file view down past what
    // the probe can give folds the probe first.
    expect(
      dragChainTarget(
        entries([200, false], [200, false], [200, false], [300, false], [48, false]),
        "v3",
        400,
      ),
    ).toBe("v4");
  });

  it("walks past a folded entry to the next one below, in order", () => {
    // outline, [open editors folded], file view: dragging outline down folds the *next open* one
    // below, skipping the header it already folded.
    expect(dragChainTarget(entries([300, false], [20, true], [48, false]), "v0", 400)).toBe("v2");
    // Nothing open below: the chain has nowhere to go, and the entries above stay put.
    expect(
      dragChainTarget(entries([300, false], [20, true], [20, true]), "v0", 400),
    ).toBeUndefined();
  });

  it("hands back only the entries that move, never the ones it left alone", () => {
    // 150 → 200 takes 50 from the 147 below it; the entry above is not touched, so it is not in
    // the result (handing drawn heights back is what made untouched entries drift).
    const drawn = redistributeOnDrag(entries([200, false], [150, false], [147, false]), "v1", 200);
    expect(drawn.get("v1")).toBe(200);
    expect(drawn.get("v2")).toBe(97);
    expect(drawn.has("v0")).toBe(false);
  });

  it("says nothing while the entries below still have room", () => {
    expect(dragChainTarget(entries([300, false], [200, false]), "v0", 340)).toBeUndefined();
  });

  it("ignores a folded entry for the room, and names the first open one below", () => {
    expect(dragChainTarget(entries([300, false], [20, true], [48, false]), "v0", 400)).toBe("v2");
  });
});

describe("moveViewInRegion (Grid.moveView within one parent, grid.ts:480-495)", () => {
  const strip = (state: LayoutState) => visibleViews(state, "r");
  const regionOf = (
    orders: Record<string, number>,
    extra: Record<string, { region?: string; hidden?: boolean }> = {},
  ): LayoutState =>
    ({
      views: Object.fromEntries(
        Object.entries(orders).map(([id, order]) => [
          id,
          { region: "r", order, hidden: false, ...extra[id] },
        ]),
      ),
    }) as unknown as LayoutState;

  it("lands a view before or after its reference", () => {
    const state = regionOf({ a: 0, b: 1, c: 2 });
    expect(strip(moveViewInRegion(state, "c", "a", "up"))).toEqual(["c", "a", "b"]);
    expect(strip(moveViewInRegion(state, "a", "c", "down"))).toEqual(["b", "c", "a"]);
    expect(strip(moveViewInRegion(state, "a", "b", "down"))).toEqual(["b", "a", "c"]);
  });

  it("changes nothing when the view is already where it is dropped", () => {
    const state = regionOf({ a: 0, b: 1, c: 2 });
    expect(moveViewInRegion(state, "b", "a", "down")).toBe(state);
    expect(moveViewInRegion(state, "b", "b", "up")).toBe(state);
  });

  it("keeps hidden views of the region in their relative places", () => {
    const state = regionOf({ a: 0, b: 1, c: 2 }, { b: { hidden: true } });
    const moved = moveViewInRegion(state, "c", "a", "up");
    expect(strip(moved)).toEqual(["c", "a"]);
    expect(moved.views.b?.order).toBe(2);
  });

  it("refuses to move across regions, or with an unknown view", () => {
    const state = regionOf({ a: 0, b: 1 }, { b: { region: "other" } });
    expect(moveViewInRegion(state, "a", "b", "down")).toBe(state);
    expect(moveViewInRegion(state, "nope", "a", "down")).toBe(state);
  });

  it("leaves the moved view's own size and fold state alone", () => {
    const state = regionOf({ a: 0, b: 1 });
    const sized = {
      ...state,
      views: { ...state.views, b: { ...state.views.b!, size: 300, collapsed: true } },
    };
    const moved = moveViewInRegion(sized, "b", "a", "up");
    expect(moved.views.b?.size).toBe(300);
    expect(moved.views.b?.collapsed).toBe(true);
  });
});
