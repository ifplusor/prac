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
  allocateStack,
  altDragTarget,
  ensureStackShape,
  entrySashState,
  regionNode,
  defaultTree,
  findNode,
  setRegionChildren,
  findRegion,
  findSplit,
  moveEntry,
  moveViewInRegion,
  place,
  redistributeOnDrag,
  regionInfos,
  removeView,
  resetStackBoundary,
  setEntryFolded,
  setEntryHeight,
  setViewCollapsed,
  setViewSize,
  stackDragAnchor,
  stackEntries,
  visibleViews,
  type Basis,
} from "./model.js";

/** A state with just the view records the fold helpers read. */
const stateOf = (
  views: Record<string, { size?: number; collapsed?: boolean; max?: number; cachedSize?: number }>,
): LayoutState => ({ views }) as unknown as LayoutState;

describe("entrySashState (B2/B4/B7: SashState of a row boundary)", () => {
  const shaped = (folded: readonly string[] = []) =>
    ensureStackShape({
      tree: setRegionChildren(defaultTree(), "left", [
        regionNode("left.explorer", 0, { label: "Explorer", stack: true }),
      ]),
      views: Object.fromEntries(
        ["a", "b", "c"].map((id, order) => [
          id,
          { region: "left.explorer", order, hidden: false, collapsed: folded.includes(id) },
        ]),
      ),
    } as unknown as LayoutState);
  const row = (view: string): string => `left.explorer/stack/${view}`;
  const drawn = (heights: Record<string, number>): Map<string, number> =>
    new Map(Object.entries(heights));

  it("lists the rows and is enabled when both directions can move", () => {
    const state = shaped();
    const node = findNode(state.tree, "left.explorer");
    expect(node?.type).toBe("split");
    expect(node === null ? 0 : stackEntries(node).length).toBe(3);
    expect(stackEntries(node!).map((entry) => entry.id)).toEqual([
      "left.explorer/stack/a",
      "left.explorer/stack/b",
      "left.explorer/stack/c",
    ]);
    const heights = drawn({
      "left.explorer/stack/a": 200,
      "left.explorer/stack/b": 200,
      "left.explorer/stack/c": 200,
    });
    expect(entrySashState(state, row("a"), heights)).toBe("enabled");
    expect(entrySashState(state, row("b"), heights)).toBe("enabled");
  });

  it("is at-minimum when only the down/right direction can move", () => {
    const state = shaped();
    const heights = drawn({
      "left.explorer/stack/a": 48,
      "left.explorer/stack/b": 200,
      "left.explorer/stack/c": 200,
    });
    expect(entrySashState(state, row("a"), heights)).toBe("at-minimum");
  });

  it("is at-maximum when only the up/left direction can move", () => {
    const state = shaped();
    const heights = drawn({
      "left.explorer/stack/a": 200,
      "left.explorer/stack/b": 48,
      "left.explorer/stack/c": 48,
    });
    expect(entrySashState(state, row("a"), heights)).toBe("at-maximum");
  });

  it("is disabled when neither direction can move", () => {
    const state = shaped();
    const heights = drawn({
      "left.explorer/stack/a": 48,
      "left.explorer/stack/b": 48,
      "left.explorer/stack/c": 48,
    });
    expect(entrySashState(state, row("a"), heights)).toBe("disabled");
  });

  it("is disabled for the last row: it has no boundary at all", () => {
    const state = shaped();
    expect(
      entrySashState(
        state,
        row("c"),
        drawn({
          "left.explorer/stack/a": 200,
          "left.explorer/stack/b": 200,
          "left.explorer/stack/c": 200,
        }),
      ),
    ).toBe("disabled");
  });

  it("is disabled when the lower side is wholly folded, and stays usable when the upper side is", () => {
    const state = shaped(["c"]);
    const heights = drawn({
      "left.explorer/stack/a": 200,
      "left.explorer/stack/b": 200,
      "left.explorer/stack/c": 22,
    });
    // b looks down at a folded c: nothing there can take room.
    expect(entrySashState(state, row("b"), heights)).toBe("disabled");
    // a has an open b below it, so its boundary is still usable.
    expect(entrySashState(state, row("a"), heights)).toBe("enabled");
  });

  it("stays usable when the row next to the sash is folded but both sides have open rows", () => {
    const state = shaped(["b"]);
    const heights = drawn({
      "left.explorer/stack/a": 200,
      "left.explorer/stack/b": 22,
      "left.explorer/stack/c": 200,
    });
    // The boundary under the folded b still has the open a above and c below.
    expect(entrySashState(state, row("b"), heights)).toBe("enabled");
  });
});

describe("stackDragAnchor (a boundary below a folded row)", () => {
  const rows = (...spec: [string, number, boolean][]) =>
    spec.map(([viewId, height, folded]) => ({ viewId, height, folded }));

  it("resizes the nearest open row above the pressed folded row", () => {
    const anchor = stackDragAnchor(
      rows(["a", 200, false], ["b", 20, true], ["c", 200, false]),
      "b",
    );
    expect(anchor?.viewId).toBe("a");
    expect(anchor?.height).toBe(200);
  });

  it("returns the pressed row when it is open", () => {
    expect(
      stackDragAnchor(rows(["a", 200, false], ["b", 20, true], ["c", 200, false]), "c")?.viewId,
    ).toBe("c");
  });

  it("has no anchor when the whole upper side is folded", () => {
    expect(stackDragAnchor(rows(["a", 20, true], ["b", 20, true]), "b")).toBeUndefined();
  });

  it("resizes an open row across a folded header", () => {
    const rowList = rows(["v0", 200, false], ["v1", 20, true], ["v2", 200, false]);
    const anchor = stackDragAnchor(rowList, "v1");
    expect(anchor?.viewId).toBe("v0");
    const sizes = redistributeOnDrag(rowList, anchor!.viewId, anchor!.height + 100);
    expect(sizes.get("v0")).toBe(300);
    expect(sizes.get("v2")).toBe(100);
    // The folded header is not written; it moves with the boundary.
    expect(sizes.has("v1")).toBe(false);
  });
});

describe("a stack keeps the name of the region it stands in for", () => {
  it("carries the label onto the split it becomes", () => {
    const tree = setRegionChildren(defaultTree(), "left", [
      regionNode("left.explorer", 0, { label: "Explorer", stack: true }),
    ]);
    const shaped = ensureStackShape({
      tree,
      views: {
        a: { region: "left.explorer", order: 0, hidden: false },
        b: { region: "left.explorer", order: 1, hidden: false },
      },
    } as unknown as LayoutState);
    // The region became a `column` split of two rows; the name has to come with the shape, or the bar
    // that switches between this region's children shows the raw id instead.
    const node = findNode(shaped.tree, "left.explorer");
    expect(node?.type).toBe("split");
    expect(node?.label).toBe("Explorer");
  });
});

describe("allocateStack (C1/C5/C6/C8: the stack shares, one row at a time)", () => {
  /** One claim per row: `size` 0 means "nobody has sized this one". */
  const rows = (spec: readonly { size?: number; min?: number; max?: number }[]): Basis[] =>
    spec.map((entry) => ({
      flex: false,
      size: entry.size ?? 0,
      min: entry.min ?? 48,
      max: entry.max ?? Number.POSITIVE_INFINITY,
      priority: "normal" as const,
    }));

  it("shares the height equally when nobody has sized anything", () => {
    expect(allocateStack(rows([{}, {}, {}]), 600)).toEqual([200, 200, 200]);
  });

  it("keeps the sizes people set and lets the unsized rows share what is left", () => {
    expect(allocateStack(rows([{ size: 200 }, {}, {}]), 600)).toEqual([200, 200, 200]);
  });

  it("shares a region resize by the rows' proportions (C8)", () => {
    // 200:100:100 of 400, over 790 ⇒ 395:197.5:197.5; the sum is exact, so C6 has no remainder.
    expect(allocateStack(rows([{ size: 200 }, { size: 100 }, { size: 100 }]), 790)).toEqual([
      395, 197.5, 197.5,
    ]);
  });

  it("never leaves a row under its floor, even when the stack is too short", () => {
    const sizes = allocateStack(rows([{ size: 300 }, { size: 300 }]), 200);
    // The proportional share (100 each) is over the floor, so the floor does not bind.
    expect(sizes).toEqual([100, 100]);
  });

  it("shares a growth by the rows' proportions, not to one row (C8)", () => {
    const sizes = allocateStack(rows([{ size: 200 }, { size: 200 }, { size: 200 }]), 700);
    // 700/3 each; no C6 remainder.
    sizes.forEach((size) => expect(size).toBeCloseTo(700 / 3));
  });

  it("clamps a proportional share at its ceiling, then sends the remainder through C6", () => {
    const sizes = allocateStack(rows([{ size: 200 }, { size: 200 }, { size: 200, max: 220 }]), 700);
    // 700/3 = 233.33; the third clamps to 220, and the 13.33 it cannot take goes to the last capable
    // row (the second, looking back) — the first is not touched.
    expect(sizes[0]).toBeCloseTo(700 / 3);
    expect(sizes[1]).toBeCloseTo(700 / 3 + (700 / 3 - 220));
    expect(sizes[2]).toBe(220);
  });

  it("leaves a folded row's header out of the proportional share", () => {
    const sizes = allocateStack(rows([{ size: 200 }, { size: 400 }, { size: 300 }]), 700, [
      false,
      false,
      true,
    ]);
    // 678/600 of the two open rows, plus the 22px folded header.
    expect(sizes[0]).toBeCloseTo((678 * 200) / 600);
    expect(sizes[1]).toBeCloseTo((678 * 400) / 600);
    expect(sizes[2]).toBe(22);
  });

  it("keeps the open sizes when they already fill the content around a folded header", () => {
    // The drag seeds the rows with their drawn heights; in that state the proportional pass is the
    // identity and must not move anything (the elastic bounce came from re-fitting stale claims).
    expect(
      allocateStack(rows([{ size: 120 }, { size: 298 }, { size: 300 }]), 440, [false, false, true]),
    ).toEqual([120, 298, 22]);
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

  it("clamps an unfolded memory at the view's ceiling (E2)", () => {
    const opened = setViewCollapsed(
      stateOf({ a: { cachedSize: 400, collapsed: true, max: 300 } }),
      "a",
      false,
    );
    expect(opened.views.a?.size).toBe(300);
  });
});

describe("setViewSize (a declaration, C3/C6)", () => {
  const state = (max?: number): LayoutState =>
    ({
      tree: defaultTree(),
      views: {
        a: { region: "left", order: 0, hidden: false, ...(max === undefined ? {} : { max }) },
      },
    }) as unknown as LayoutState;

  it("clamps a declared height to the floor and the view's ceiling", () => {
    const below = setViewSize(state(300), "a", 20);
    expect(below.views.a?.size).toBe(48);
    const above = setViewSize(state(300), "a", 400);
    expect(above.views.a?.size).toBe(300);
    expect(setViewSize(above, "a", 300)).toBe(above);
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

describe("altDragTarget (B6: the adjacent view's half)", () => {
  const entries = (...rows: [number, boolean][]) =>
    rows.map(([height, folded], index) => ({ viewId: `v${index}`, height, folded }));

  it("limits a non-last boundary to half the next view's headroom", () => {
    // v1 is 200, floor 48: maxDelta = (200 − 48) / 2 = 76; a +100 request becomes +76.
    expect(altDragTarget(entries([200, false], [200, false], [200, false]), "v0", 300)).toBe(276);
    // No declared maximum above, so a shrink is not limited on this side.
    expect(altDragTarget(entries([200, false], [200, false], [200, false]), "v0", 100)).toBe(100);
  });

  it("limits the last boundary to half the dragged view's shrink", () => {
    // The boundary under v0 is the last one; its upper view is 200: minDelta = (48 − 200) / 2 = −76.
    expect(altDragTarget(entries([200, false], [200, false]), "v0", 100)).toBe(124);
    expect(altDragTarget(entries([200, false], [200, false]), "v0", 400)).toBe(400);
  });

  it("skips a folded row when it measures the view across the boundary", () => {
    // v1 is folded; the next open row is v2 at 200: maxDelta = (200 - 48) / 2 = 76.
    expect(altDragTarget(entries([200, false], [20, true], [200, false]), "v0", 300)).toBe(276);
  });

  it("leaves a folded row or a non-boundary id alone", () => {
    const rows = entries([200, true], [200, false]);
    expect(altDragTarget(rows, "v0", 300)).toBe(300);
    expect(altDragTarget(rows, "v1", 300)).toBe(300);
    expect(altDragTarget(rows, "missing", 300)).toBe(300);
  });
});

describe("resetStackBoundary (SplitView's sash reset, splitview.ts:1186)", () => {
  const rows = (...spec: [number, boolean][]) =>
    spec.map(([height, folded], index) => ({ viewId: `v${index}`, height, folded }));

  it("evens out the nearest rows above and below", () => {
    const reset = resetStackBoundary(rows([300, false], [100, false], [200, false]), "v0");
    expect(reset).toEqual([
      { viewId: "v0", height: 200 },
      { viewId: "v1", height: 200 },
    ]);
  });

  it("looks past folded rows for the pair, and refuses when a whole side is folded", () => {
    // The boundary at v1's bottom edge: v1 itself is folded, so the pair is v0 with v2.
    expect(resetStackBoundary(rows([100, false], [50, true], [300, false]), "v1")).toEqual([
      { viewId: "v0", height: 200 },
      { viewId: "v2", height: 200 },
    ]);
    // Every row above the boundary is folded: nothing to even out with (upstream returns early).
    expect(resetStackBoundary(rows([50, true], [50, true], [300, false]), "v1")).toEqual([]);
    // Every row below it is folded.
    expect(resetStackBoundary(rows([300, false], [50, true], [50, true]), "v0")).toEqual([]);
  });

  it("never evens a pair below the floor", () => {
    const reset = resetStackBoundary(rows([10, false], [10, false]), "v0");
    expect(reset).toEqual([
      { viewId: "v0", height: 48 },
      { viewId: "v1", height: 48 },
    ]);
  });

  it("does nothing for a row that is not in the stack", () => {
    expect(resetStackBoundary(rows([100, false], [100, false]), "nope")).toEqual([]);
  });
});

describe("ensureStackShape (S2 step 1: a stack becomes a column split of one-view leaves)", () => {
  const stateWith = (tree: unknown, views: Record<string, unknown>): LayoutState =>
    ({ tree, views }) as unknown as LayoutState;
  const region = (id: string, size: number, extra: Record<string, unknown> = {}) => ({
    type: "region",
    id,
    size,
    flex: false,
    collapsed: false,
    cachedSize: size,
    min: 40,
    ...extra,
  });
  const view = (regionId: string, order: number, extra: Record<string, unknown> = {}) => ({
    region: regionId,
    order,
    hidden: false,
    ...extra,
  });

  it("turns a stack of two visible views into a column split of leaves, keeping the region's id", () => {
    const state = stateWith(region("left", 300, { stack: true }), {
      a: view("left", 0, { size: 120 }),
      b: view("left", 1, { collapsed: true, cachedSize: 80 }),
      c: view("left", 2),
    });
    const shaped = ensureStackShape(state);
    expect(shaped.tree).toMatchObject({ type: "split", id: "left", dir: "column", size: 300 });
    const children = (shaped.tree as unknown as { children: Record<string, unknown>[] }).children;
    // A sized row keeps its height, a folded row is its header, and a row nobody sized carries **no
    // height of its own** (0 + flexible): it shares whatever the others leave.
    expect(children.map((child) => [child.id, child.size, child.collapsed, child.flex])).toEqual([
      ["left/stack/a", 120, false, false],
      ["left/stack/b", 0, true, false],
      ["left/stack/c", 0, false, true],
    ]);
    // the height and the fold live in the tree now; the records do not carry them
    expect(shaped.views.a?.region).toBe("left/stack/a");
    expect(shaped.views.a?.size).toBeUndefined();
    expect(shaped.views.c?.size).toBeUndefined();
  });

  it("normalises to itself, and leaves one-view stacks and tabs regions alone", () => {
    const state = stateWith(region("left", 300, { stack: true }), {
      a: view("left", 0),
      b: view("left", 1),
    });
    const once = ensureStackShape(state);
    expect(ensureStackShape(once)).toBe(once);
    const single = stateWith(region("left", 300, { stack: true }), { a: view("left", 0) });
    expect(ensureStackShape(single)).toBe(single);
    const tabs = stateWith(region("left", 300, { tabs: "multiple" }), {
      a: view("left", 0),
      b: view("left", 1),
    });
    expect(ensureStackShape(tabs)).toBe(tabs);
    // hidden views are not rows, so they do not become leaves
    const hidden = stateWith(region("left", 300, { stack: true }), {
      a: view("left", 0),
      b: view("left", 1, { hidden: true }),
    });
    expect(ensureStackShape(hidden)).toBe(hidden);
  });
});

describe("stack entries (S2: the rows are leaf regions)", () => {
  const shaped = () =>
    ensureStackShape({
      tree: {
        type: "region",
        id: "left",
        size: 300,
        flex: false,
        collapsed: false,
        cachedSize: 300,
        min: 40,
        stack: true,
      },
      views: {
        a: { region: "left", order: 0, hidden: false, size: 120 },
        b: { region: "left", order: 1, hidden: false, size: 80 },
      },
    } as unknown as LayoutState);

  it("lists the rows and numbers them by the tree, not the records", () => {
    const entries = stackEntries(shaped().tree);
    expect(entries.map((entry) => [entry.id, entry.size])).toEqual([
      ["left/stack/a", 120],
      ["left/stack/b", 80],
    ]);
  });

  it("writes a row's height and fold onto its leaf", () => {
    const state = shaped();
    const taller = setEntryHeight(state, "left/stack/a", 200);
    expect(findRegion(taller.tree, "left/stack/a")?.size).toBe(200);
    expect(setEntryHeight(taller, "left/stack/a", 200)).toBe(taller);
    const folded = setEntryFolded(state, "left/stack/a", true, 120);
    const leaf = findRegion(folded.tree, "left/stack/a");
    expect(leaf?.collapsed).toBe(true);
    // A folded row has no height of its own: the header is drawing, the memory is `cachedSize`.
    expect(leaf?.size).toBe(0);
    expect(leaf?.cachedSize).toBe(120);
    expect(
      findRegion(setEntryFolded(folded, "left/stack/a", false).tree, "left/stack/a")?.size,
    ).toBe(120);
  });

  it("clamps a row's height to the view's ceiling", () => {
    const state = ensureStackShape({
      tree: {
        type: "region",
        id: "left",
        size: 300,
        flex: false,
        collapsed: false,
        cachedSize: 300,
        min: 40,
        stack: true,
      },
      views: {
        a: { region: "left", order: 0, hidden: false, max: 150 },
        b: { region: "left", order: 1, hidden: false },
      },
    } as unknown as LayoutState);
    const next = setEntryHeight(state, "left/stack/a", 300);
    expect(findRegion(next.tree, "left/stack/a")?.size).toBe(150);
  });

  it("reorders the split's children by reference and direction", () => {
    const state = shaped();
    const swapped = moveEntry(state, "left/stack/b", "left/stack/a", "up");
    expect(stackEntries(swapped.tree).map((entry) => entry.id)).toEqual([
      "left/stack/b",
      "left/stack/a",
    ]);
    expect(moveEntry(state, "left/stack/a", "left/stack/b", "up")).toBe(state);
  });
});

describe("addressing a stack that lives under a region", () => {
  const nested = () =>
    ensureStackShape({
      tree: setRegionChildren(defaultTree(), "left", [
        regionNode("left.explorer", 0, { stack: true, flex: true }),
      ]),
      views: {
        a: { region: "left.explorer", order: 0, hidden: false },
        b: { region: "left.explorer", order: 1, hidden: false },
        c: { region: "left.explorer", order: 2, hidden: false },
      },
    } as unknown as LayoutState);
  const rows = (state: LayoutState): string[] => {
    const node = findNode(state.tree, "left.explorer");
    return node === null ? [] : stackEntries(node).map((row) => row.id.split("/").pop() ?? "");
  };

  it("finds the split through the region, and lists its rows", () => {
    const state = nested();
    expect(findSplit(state.tree, "left.explorer")?.id).toBe("left.explorer");
    expect(visibleViews(state, "left.explorer")).toEqual(["a", "b", "c"]);
  });

  it("lists a stack as one movable position, not as its internal rows", () => {
    const state = nested();
    const left = findNode(state.tree, "left");
    expect(left === null ? [] : regionInfos(left).map((region) => region.id)).toEqual([
      "left",
      "left.explorer",
    ]);
  });

  it("places an already-stacked view idempotently instead of appending a duplicate leaf", () => {
    const state = nested();
    const once = place(state, "b", "left.explorer");
    expect(rows(once)).toEqual(["a", "b", "c"]);
    expect(place(once, "b", "left.explorer")).toBe(once);
  });

  it("reorders a nested stack and syncs the views' order", () => {
    const state = nested();
    const next = moveEntry(state, "left.explorer/stack/b", "left.explorer/stack/a", "up");
    expect(rows(next)).toEqual(["b", "a", "c"]);
    expect(next.views["b"]?.order).toBe(0);
    expect(next.views["a"]?.order).toBe(1);
    expect(next.views["c"]?.order).toBe(2);
  });

  const setHidden = (state: LayoutState, viewId: string, hidden: boolean): LayoutState => {
    const record = state.views[viewId];
    return record === undefined
      ? state
      : { ...state, views: { ...state.views, [viewId]: { ...record, hidden } } };
  };

  it("drops a hidden view's row and writes its place back to the record", () => {
    const state = ensureStackShape(setHidden(nested(), "b", true));
    expect(rows(state)).toEqual(["a", "c"]);
    expect(state.views["b"]?.region).toBe("left.explorer");
    expect(state.views["b"]?.hidden).toBe(true);
  });

  it("round-trips a stack through one visible view and shows a hidden view back", () => {
    let state = ensureStackShape(setHidden(nested(), "b", true));
    state = ensureStackShape(setHidden(state, "c", true));
    expect(findNode(state.tree, "left.explorer")?.type).toBe("region");
    expect(state.views["a"]?.region).toBe("left.explorer");
    state = ensureStackShape(setHidden(state, "b", false));
    expect(rows(state)).toEqual(["a", "b"]);
    expect(state.views["b"]?.region).toBe("left.explorer/stack/b");
  });

  it("keeps a folded row's memory through the melt and back", () => {
    let state = setEntryFolded(nested(), "left.explorer/stack/c", true, 200);
    state = ensureStackShape(setHidden(state, "a", true));
    state = ensureStackShape(setHidden(state, "b", true));
    const melted = findRegion(state.tree, "left.explorer");
    expect(melted?.type).toBe("region");
    expect(melted?.collapsed).toBe(false);
    expect(state.views["c"]?.collapsed).toBe(true);
    expect(state.views["c"]?.cachedSize).toBe(200);
    state = ensureStackShape(setHidden(state, "a", false));
    expect(rows(state)).toEqual(["a", "c"]);
    const c = findRegion(state.tree, "left.explorer/stack/c");
    expect(c?.collapsed).toBe(true);
    expect(c?.cachedSize).toBe(200);
    expect(c?.size).toBe(0);
  });

  it("drops a removed view's row without leaving a blank", () => {
    expect(rows(ensureStackShape(removeView(nested(), "b")))).toEqual(["a", "c"]);
  });
});

describe("setEntryFolded routes the difference (design C5/C6)", () => {
  const stack = (sizes: Record<string, number>) =>
    ensureStackShape({
      tree: {
        type: "region",
        id: "left",
        size: 600,
        flex: false,
        collapsed: false,
        cachedSize: 600,
        min: 40,
        stack: true,
      },
      views: Object.fromEntries(
        Object.entries(sizes).map(([id, size], order) => [
          id,
          { region: "left", order, hidden: false, size },
        ]),
      ),
    } as unknown as LayoutState);
  const heights = (state: LayoutState) =>
    Object.fromEntries(
      stackEntries(findSplit(state.tree, "left")!).map((row) => [
        row.id.split("/").pop(),
        row.size,
      ]),
    );

  it("gives a folded row's room to the rows below, whole, from the last one back", () => {
    const folded = setEntryFolded(stack({ a: 200, b: 200, c: 200 }), "left/stack/a", true, 200);
    // `a` is a header; the last row took the 180 the fold freed — not a share of it.
    expect(heights(folded)).toEqual({ a: 0, b: 200, c: 378 });
  });

  it("uses an unsized row's drawn height as the room its fold frees", () => {
    const folded = setEntryFolded(stack({ a: 0, b: 200, c: 200 }), "left/stack/a", true, 200);
    expect(heights(folded)).toEqual({ a: 0, b: 200, c: 378 });
  });

  it("takes what an unfolded row needs from below, never under the floor", () => {
    const state = stack({ a: 200, b: 60, c: 340 });
    const folded = setEntryFolded(state, "left/stack/a", true, 200);
    expect(heights(folded).c).toBe(518);
    const opened = setEntryFolded(folded, "left/stack/a", false);
    // `a` remembers 200: the last row gives it back.
    expect(heights(opened)).toEqual({ a: 200, b: 60, c: 340 });
  });

  it("falls back to the rows above when there is nothing below, nearest first", () => {
    const folded = setEntryFolded(stack({ a: 200, b: 200, c: 200 }), "left/stack/c", true, 200);
    expect(heights(folded)).toEqual({ a: 200, b: 378, c: 0 });
  });

  it("clamps an unfolded row to the view's ceiling", () => {
    const state = ensureStackShape({
      tree: {
        type: "region",
        id: "left",
        size: 600,
        flex: false,
        collapsed: false,
        cachedSize: 600,
        min: 40,
        stack: true,
      },
      views: {
        a: {
          region: "left",
          order: 0,
          hidden: false,
          collapsed: true,
          cachedSize: 400,
          max: 300,
        },
        b: { region: "left", order: 1, hidden: false, size: 200 },
      },
    } as unknown as LayoutState);
    const opened = setEntryFolded(state, "left/stack/a", false);
    expect(findRegion(opened.tree, "left/stack/a")?.size).toBe(300);
  });
});
