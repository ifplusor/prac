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
} from "./model.js";

const HEIGHT = 734;

/** A state with just the view records `allocateStack` reads. */
const stateOf = (views: Record<string, { size?: number; collapsed?: boolean }>): LayoutState =>
  ({ views }) as unknown as LayoutState;

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

  it("shares room left over in proportion, never to one entry alone", () => {
    const views = ["a", "b", "c", "d"];
    // Sizes whose sum leaves a genuine leftover (300 + 100 + 100 + 100 = 600 of 734).
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
    expect(drawn.get("a")).toBeGreaterThan(300);
    expect(drawn.get("d") ?? 0).toBeGreaterThan(100);
    // Nobody swallows the whole 134.
    expect(drawn.get("d") ?? 0).toBeLessThan(300);
    expect(heights(views, drawn).reduce((total, size) => total + size, 0)).toBe(HEIGHT);
  });

  it("gives a fold's room in proportion, and leaves the folded entry its own size alone", () => {
    const views = ["a", "b", "c", "d"];
    const foldedLast = allocateStack(
      views,
      stateOf({ a: { size: 300 }, b: {}, c: {}, d: { collapsed: true } }),
      new Map([
        ["b", 100],
        ["c", 100],
      ]),
      HEIGHT,
    );
    expect(foldedLast.get("d")).toBe(HEADER_HEIGHT);
    expect(foldedLast.get("c") ?? 0).toBeGreaterThan(100);
    expect(foldedLast.get("b") ?? 0).toBeGreaterThan(100);
    // In proportion: `a` holds three times `b`, so it takes three times as much of the room.
    expect((foldedLast.get("a") ?? 0) - 300).toBeGreaterThan((foldedLast.get("c") ?? 0) - 100);
    expect(heights(views, foldedLast).reduce((total, size) => total + size, 0)).toBe(HEIGHT);
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
  it("remembers what an unsized entry was drawn at when it folds", () => {
    const state = stateOf({ a: {}, b: {} });
    const folded = setViewCollapsed(state, "a", true, 173);
    expect(folded.views.a?.collapsed).toBe(true);
    expect(folded.views.a?.size).toBe(173);
    expect(setViewCollapsed(folded, "a", false, 20).views.a?.size).toBe(173);
  });

  it("keeps a size somebody dragged, whatever the measurement says", () => {
    const folded = setViewCollapsed(stateOf({ a: { size: 300 } }), "a", true, 173);
    expect(folded.views.a?.size).toBe(300);
  });

  it("unfolds at the height it is measured at when nothing was remembered", () => {
    const opened = setViewCollapsed(stateOf({ a: { collapsed: true } }), "a", false, 147);
    expect(opened.views.a?.size).toBe(147);
  });

  it("drops a header-sized leftover when unfolding, and invents nothing without a measurement", () => {
    const leftover = setViewCollapsed(
      stateOf({ a: { size: 18, collapsed: true } }),
      "a",
      false,
      18,
    );
    expect(leftover.views.a?.size).toBeUndefined();
    const unmeasured = setViewCollapsed(stateOf({ a: {} }), "a", true);
    expect(unmeasured.views.a?.size).toBeUndefined();
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
