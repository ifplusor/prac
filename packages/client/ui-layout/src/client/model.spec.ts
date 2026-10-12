import { describe, expect, it } from "vite-plus/test";
import {
  CENTER_MIN,
  CENTER_REGION,
  BOTTOM_REGION,
  DEFAULT_MIN,
  SASH_SIZE,
  type LayoutNode,
  type LayoutState,
  type RegionNode,
} from "./contract.js";
import {
  activeChild,
  defaultTree,
  findRegion,
  findSplit,
  freshNodeId,
  frontView,
  isPresent,
  isStacked,
  nodeBasis,
  place,
  regionInfos,
  regionNode,
  removeView,
  setFront,
  resolveSizes,
  sashSizes,
  selectChild,
  setRegionChildren,
  showsTabStrip,
  setCollapsed,
  setRegionSize,
  sideGeometry,
  splitRegionWith,
  subtreeMin,
  visibleViews,
} from "./model.js";

/**
 * The mechanism's pure core, tested without a browser.
 *
 * The layout model is where the arithmetic lives — region tree rewrites, the
 * flexbox mirror (`resolveSizes`), visibility, and the sash clamp. Bugs here are
 * *silent in a live page* for the failure mode recorded in the notes ("sash only
 * had a lower bound": 23 gate assertions passed and the layout was still
 * broken), so the extremes belong in tests that run in milliseconds.
 */
const state = (
  tree: LayoutNode = defaultTree(),
  views: LayoutState["views"] = {},
): LayoutState => ({
  viewportWidth: 1000,
  viewportHeight: 800,
  tree,
  views,
  catalogueVersion: 0,
  activePanelId: null,
});

describe("defaultTree", () => {
  it("is the row the arrangement starts with, plus a bottom bar", () => {
    expect(regionInfos(defaultTree()).map((region) => region.id)).toEqual([
      "left",
      CENTER_REGION,
      "right",
      BOTTOM_REGION,
    ]);
  });

  it("sizes the row's fixed tracks and keeps the centre flexible", () => {
    const tree = defaultTree();
    const left = findRegion(tree, "left");
    const centre = findRegion(tree, CENTER_REGION);
    const right = findRegion(tree, "right");
    expect(left?.size).toBe(280);
    expect(centre?.flex).toBe(true);
    expect(centre?.min).toBe(CENTER_MIN);
    expect(right?.size).toBe(420);
    // The bottom bar is empty at boot, so a fixed region that is not rendered
    // costs the default layout nothing.
    expect(findRegion(tree, BOTTOM_REGION)?.size).toBe(240);
    expect(isPresent(state(), findRegion(tree, BOTTOM_REGION)!)).toBe(false);
  });

  it("marks both side tracks as stacks and the centre as not one", () => {
    const tree = defaultTree();
    expect(findRegion(tree, "left")?.stack).toBe(true);
    expect(findRegion(tree, "right")?.stack).toBe(true);
    expect(findRegion(tree, CENTER_REGION)?.stack).toBeUndefined();
  });

  it("gives the centre the tab strip, at VS Code's default tab visibility", () => {
    const tree = defaultTree();
    // Borrowed: `workbench.editor.showTabs` defaults to `"multiple"`, so the
    // strip is there for a single view too.
    expect(findRegion(tree, CENTER_REGION)?.tabs).toBe("multiple");
    expect(findRegion(tree, "left")?.tabs).toBeUndefined();
    expect(findRegion(tree, BOTTOM_REGION)?.tabs).toBeUndefined();
  });
});

describe("placement", () => {
  it("places a view visibly as its region's front", () => {
    const next = place(state(), "dsh:sidebar", "left");
    expect(next.views["dsh:sidebar"]).toMatchObject({
      region: "left",
      order: 0,
      hidden: false,
      front: true,
    });
  });

  it("orders the front-most view first and skips hidden ones", () => {
    let current = place(state(), "dsh:sidebar", "left");
    current = place(current, "vscode:view:a", "left");
    current = {
      ...current,
      views: {
        ...current.views,
        "vscode:view:a": { ...current.views["vscode:view:a"]!, hidden: true },
      },
    };
    expect(visibleViews(current, "left")).toEqual(["dsh:sidebar"]);
    expect(frontView(current, "left")).toBe("dsh:sidebar");
    expect(visibleViews(current, "right")).toEqual([]);
    expect(frontView(current, "right")).toBeUndefined();
  });

  it("appends a new placement and makes it the front", () => {
    let current = place(state(), "a", "left");
    current = place(current, "b", "left");
    // The strip is **open order** (VS Code appends tabs); "who is shown" is the front
    // marker, so placing `b` does not move `a`.
    expect(visibleViews(current, "left")).toEqual(["a", "b"]);
    expect(frontView(current, "left")).toBe("b");
  });

  it("changes the front without reordering the strip", () => {
    let current = place(state(), "a", "left");
    current = place(current, "b", "left");
    const clicked = setFront(current, "a");
    expect(visibleViews(clicked, "left")).toEqual(["a", "b"]);
    expect(frontView(clicked, "left")).toBe("a");
    expect(clicked.views.a?.order).toBe(current.views.a?.order);
  });

  it("is a no-op when the view already holds the region's front", () => {
    const current = place(state(), "a", "left");
    // The very same state object: a caller reacting to a change must not be able to
    // produce a change of its own by asking for what already holds.
    expect(place(current, "a", "left")).toBe(current);
    // …while placing the *other* view, or the same view elsewhere, still moves.
    const other = place(current, "b", "left");
    expect(place(other, "a", "left")).not.toBe(other);
    expect(place(other, "a", "right").views.a?.region).toBe("right");
    // A hidden view is not "already there": placing it shows it again.
    const hidden = {
      ...current,
      views: { ...current.views, a: { ...current.views.a!, hidden: true } },
    };
    expect(place(hidden, "a", "left").views.a).toMatchObject({ hidden: false });
  });

  it("keeps a view's header cost invisible until a second one arrives", () => {
    const one = place(state(), "dsh:sidebar", "left");
    expect(isStacked(one, findRegion(one.tree, "left")!)).toBe(false);
    const two = place(one, "vscode:view:a", "left");
    expect(isStacked(two, findRegion(two.tree, "left")!)).toBe(true);
    // Folding does not un-stack: the header is what carries the fold.
    const folded = {
      ...two,
      views: {
        ...two.views,
        "vscode:view:a": { ...two.views["vscode:view:a"]!, collapsed: true },
      },
    };
    expect(isStacked(folded, findRegion(folded.tree, "left")!)).toBe(true);
  });

  it("never calls a non-stack region stacked, even with two views", () => {
    const two = place(place(state(), "a", CENTER_REGION), "b", CENTER_REGION);
    expect(isStacked(two, findRegion(two.tree, CENTER_REGION)!)).toBe(false);
  });

  it("forgets a view's record entirely, and the child it had of its own", () => {
    // A file view whose file the app no longer has open has nothing to come back to; the
    // record is what the frame persists, and a fresh placement of that file is named
    // again — so a remembered one would block it.
    const one = place(state(), "vscode:file:p1:x", "left");
    expect(one.views["vscode:file:p1:x"]).toBeDefined();
    const forgotten = removeView(one, "vscode:file:p1:x");
    expect(forgotten.views["vscode:file:p1:x"]).toBeUndefined();
    // A view that is not there is not a change: a caller re-running its sync must not
    // wake the store.
    expect(removeView(forgotten, "vscode:file:p1:x")).toBe(forgotten);
    // A selector region's child exists for one view, so it goes with it.
    const selector = setRegionChildren(one.tree, "left", [
      regionNode("left/keep", 0, { stack: true }),
    ]);
    const held = { ...one, tree: selectChild(selector, "left", "left/keep") };
    const placed = place(held, "vscode:file:p2:y", "left");
    expect(findRegion(placed.tree, "left/vscode:file:p2:y")).not.toBeNull();
    expect(
      findRegion(removeView(placed, "vscode:file:p2:y").tree, "left/vscode:file:p2:y"),
    ).toBeNull();
  });

  it("mints node ids the restored tree has not taken", () => {
    // The counter restarts every page load while the tree persists, so a split after a
    // reload used to be able to reuse a restored region's id — and two regions with one id
    // are rendered twice, with the views in them mounted twice.
    const restored = splitRegionWith(state(), CENTER_REGION, "right", "split-1", "region-1");
    let seq = 0;
    // A fresh counter's very first candidate is the id the restored tree already carries.
    expect(freshNodeId(restored.tree, "region", () => (seq += 1))).toBe("region-2");
    expect(findRegion(restored.tree, "region-2")).toBeNull();
  });
});

describe("showsTabStrip", () => {
  const region = (extra: Partial<RegionNode> = {}) => regionNode("r", 300, extra);

  it("shows for a single view when the mode is VS Code's default", () => {
    const one = place(state(), "a", "r");
    expect(showsTabStrip(one, findRegion(one.tree, "r") ?? region({ tabs: "multiple" }))).toBe(
      true,
    );
    const node = region({ tabs: "multiple" });
    expect(showsTabStrip({ ...one, tree: node }, node)).toBe(true);
  });

  it("waits for a second view in `single`, and never shows in `none`", () => {
    const single = region({ tabs: "single" });
    const one = place({ ...state(), tree: single }, "a", "r");
    expect(showsTabStrip(one, single)).toBe(false);
    const two = place(one, "b", "r");
    expect(showsTabStrip(two, single)).toBe(true);
    expect(showsTabStrip(two, region({ tabs: "none" }))).toBe(false);
  });

  it("never shows for a region without a tab mode, however many views it holds", () => {
    const plain = region();
    const two = place(place({ ...state(), tree: plain }, "a", "r"), "b", "r");
    expect(showsTabStrip(two, plain)).toBe(false);
    // …and a split node is never a strip: it has no views of its own.
    expect(showsTabStrip(two, defaultTree())).toBe(false);
  });
});

describe("isPresent", () => {
  it("keeps a flexible region present while empty", () => {
    expect(isPresent(state(), findRegion(defaultTree(), CENTER_REGION)!)).toBe(true);
  });

  it("drops a fixed region that has nothing visible to show", () => {
    const current = place(state(), "dsh:sidebar", "left");
    expect(isPresent(current, findRegion(current.tree, "left")!)).toBe(true);
    const emptied = place(current, "dsh:sidebar", CENTER_REGION);
    expect(isPresent(emptied, findRegion(emptied.tree, "left")!)).toBe(false);
  });

  it("keeps a collapsed region present at zero extent", () => {
    const collapsed = setCollapsed(state(), "right", true);
    expect(isPresent(collapsed, findRegion(collapsed.tree, "right")!)).toBe(true);
  });

  it("keeps a split present when any child is", () => {
    const current = place(state(), "dsh:sidebar", "left");
    const split = splitRegionWith(current, "left", "right", "split-1", "region-1");
    expect(isPresent(split, findSplit(split.tree, "split-1")!)).toBe(true);
  });
});

describe("resolveSizes", () => {
  it("gives fixed tracks their size and shares the rest with the flexible one", () => {
    const current = place(place(state(), "dsh:sidebar", "left"), "vscode:view:b", "right");
    const boxes = resolveSizes(current, 1000, 800);
    // Three present children, two sashes; the centre absorbs what is left.
    expect(boxes.get("left")).toEqual({ width: 280, height: 800 });
    expect(boxes.get("right")).toEqual({ width: 420, height: 800 });
    expect(boxes.get(CENTER_REGION)?.width).toBe(1000 - 280 - 420 - 2 * SASH_SIZE);
  });

  it("leaves an empty fixed track out of the box map, and its sash with it", () => {
    const boxes = resolveSizes(state(), 1000, 800);
    expect(boxes.has("left")).toBe(false);
    expect(boxes.has("right")).toBe(false);
    // Nothing to share with: the centre work area takes the whole frame.
    expect(boxes.get(CENTER_REGION)?.width).toBe(1000);
  });

  it("splits the root column between the row and the bottom bar", () => {
    const current = place(place(state(), "dsh:sidebar", "left"), "terminal", BOTTOM_REGION);
    const boxes = resolveSizes(current, 1000, 800);
    expect(boxes.get(BOTTOM_REGION)).toEqual({ width: 1000, height: 240 });
    expect(boxes.get("left")?.height).toBe(800 - 240 - SASH_SIZE);
  });

  it("gives a collapsed region no extent, sash still counted", () => {
    const current = setCollapsed(state(), "right", true);
    const boxes = resolveSizes(current, 1000, 800);
    expect(boxes.get("right")?.width).toBe(0);
  });

  it("shares evenly between two flexible siblings", () => {
    const split = splitRegionWith(state(), CENTER_REGION, "right", "split-1", "region-1");
    const boxes = resolveSizes(split, 1000, 800);
    const centre = boxes.get(CENTER_REGION)?.width ?? 0;
    const fresh = boxes.get("region-1")?.width ?? 0;
    expect(fresh).toBeGreaterThan(0);
    expect(Math.abs(centre - fresh)).toBeLessThanOrEqual(1);
  });
});

describe("setCollapsed", () => {
  it("remembers the size it had and gives it back", () => {
    const collapsed = setCollapsed(state(), "right", true);
    expect(findRegion(collapsed.tree, "right")?.size).toBe(0);
    expect(findRegion(collapsed.tree, "right")?.cachedSize).toBe(420);
    const expanded = setCollapsed(collapsed, "right", false);
    expect(findRegion(expanded.tree, "right")?.size).toBe(420);
  });

  it("is a no-op, by identity, when the state already matches", () => {
    const current = state();
    expect(setCollapsed(current, "right", false)).toBe(current);
    expect(setCollapsed(current, "nope", true)).toBe(current);
    const collapsed = setCollapsed(current, "right", true);
    expect(setCollapsed(collapsed, "right", true)).toBe(collapsed);
  });
});

describe("setRegionSize / nodeBasis / subtreeMin", () => {
  it("rounds and never goes negative", () => {
    const tree = setRegionSize(defaultTree(), "left", -10.4);
    expect(findRegion(tree, "left")?.size).toBe(0);
    const rounded = setRegionSize(defaultTree(), "left", 300.6);
    expect(findRegion(rounded, "left")?.size).toBe(301);
  });

  it("reads a split as flexible and a collapsed region as zero-basis", () => {
    expect(nodeBasis({ type: "split", id: "s", dir: "row", children: [] })).toEqual({
      flex: true,
      size: 0,
    });
    expect(nodeBasis(regionNode("r", 300, { collapsed: true, cachedSize: 300 }))).toEqual({
      flex: false,
      size: 0,
    });
  });

  it("sums the minima of a subtree", () => {
    const split = splitRegionWith(state(), "right", "down", "split-1", "region-1");
    expect(subtreeMin(findSplit(split.tree, "split-1")!)).toBe(DEFAULT_MIN * 2);
  });
});

describe("sashSizes", () => {
  const fixed = (size: number, min = DEFAULT_MIN): RegionNode =>
    regionNode("r", size, { flex: false, min, cachedSize: size });
  const flex = (min = DEFAULT_MIN): RegionNode => regionNode("f", 0, { flex: true, min });

  it("refuses to move a flex|flex boundary", () => {
    expect(sashSizes(flex(), flex(), 100, 800)).toBeNull();
  });

  it("keeps the pair's total when both are fixed", () => {
    const sizes = sashSizes(fixed(300), fixed(300), 100, 800);
    expect(sizes).toEqual({ a: 400, b: 200 });
    expect((sizes?.a ?? 0) + (sizes?.b ?? 0)).toBe(600);
  });

  it("clamps both ends at their minima, and the pair at its own total", () => {
    expect(sashSizes(fixed(300), fixed(300), -500, 800)).toEqual({ a: 120, b: 480 });
    // Both fixed: the pair cannot grow, so `a` stops where `b` hits its minimum.
    expect(sashSizes(fixed(300), fixed(300), 500, 800)).toEqual({ a: 480, b: 120 });
  });

  it("stops a fixed region at the shared budget, not at the neighbour's zero", () => {
    // The recorded bug: without the budget the fixed neighbour grew past what
    // the split had, squeezing its flex sibling out of existence.
    const sizes = sashSizes(fixed(300), flex(200), 5000, 600);
    expect(sizes?.a).toBe(400);
    expect((sizes?.a ?? 0) + 200).toBe(600);
  });

  it("moves the fixed side whichever side it is on", () => {
    expect(sashSizes(fixed(300), flex(), -100, 800)).toEqual({ a: 200 });
    expect(sashSizes(flex(), fixed(300), 100, 800)).toEqual({ b: 200 });
  });
});

describe("sideGeometry / splitRegionWith", () => {
  it("turns a side into an axis and an insertion order", () => {
    expect(sideGeometry("left")).toEqual({ dir: "row", before: true });
    expect(sideGeometry("right")).toEqual({ dir: "row", before: false });
    expect(sideGeometry("up")).toEqual({ dir: "column", before: true });
    expect(sideGeometry("down")).toEqual({ dir: "column", before: false });
  });

  it("puts the new pane after the source for right", () => {
    const split = splitRegionWith(state(), CENTER_REGION, "right", "split-1", "region-1");
    expect(findSplit(split.tree, "split-1")?.dir).toBe("row");
    expect(regionInfos(findSplit(split.tree, "split-1")!).map((region) => region.id)).toEqual([
      CENTER_REGION,
      "region-1",
    ]);
  });

  it("puts the new pane before the source for left and up", () => {
    for (const side of ["left", "up"] as const) {
      const split = splitRegionWith(state(), CENTER_REGION, side, "split-1", "region-1");
      expect(regionInfos(findSplit(split.tree, "split-1")!).map((region) => region.id)).toEqual([
        "region-1",
        CENTER_REGION,
      ]);
    }
  });

  it("leaves the source's own size and flexibility alone", () => {
    const split = splitRegionWith(state(), "left", "right", "split-1", "region-1");
    const source = findRegion(split.tree, "left");
    expect(source?.size).toBe(280);
    expect(source?.flex).toBe(false);
    expect(findRegion(split.tree, "region-1")?.flex).toBe(true);
  });

  it("adds exactly one region per call and nests", () => {
    const first = splitRegionWith(state(), CENTER_REGION, "right", "split-1", "region-1");
    const second = splitRegionWith(first, "region-1", "down", "split-2", "region-2");
    expect(regionInfos(second.tree).map((region) => region.id)).toEqual([
      "left",
      CENTER_REGION,
      "region-1",
      "region-2",
      "right",
      BOTTOM_REGION,
    ]);
    expect(findSplit(second.tree, "split-2")?.dir).toBe("column");
  });

  it("is a no-op, by identity, for a region that is not there", () => {
    const current = state();
    expect(splitRegionWith(current, "nope", "right", "split-1", "region-1")).toBe(current);
  });
});

describe("nested regions (containers)", () => {
  /** `left` as a selector over two named container children. */
  const withContainers = () =>
    setRegionChildren(defaultTree(), "left", [
      regionNode("left.explorer", 0, { label: "Explorer" }),
      regionNode("left.search", 0, { label: "Search" }),
    ]);

  /** One visible view in each container, so both are present. */
  const bothFilled: LayoutState["views"] = {
    a: { region: "left.explorer", order: 0, hidden: false },
    b: { region: "left.search", order: 0, hidden: false },
  };

  it("lists nested regions in tree order, children after their parent", () => {
    expect(regionInfos(withContainers()).map((region) => region.id)).toEqual([
      "left",
      "left.explorer",
      "left.search",
      CENTER_REGION,
      "right",
      BOTTOM_REGION,
    ]);
  });

  it("finds a nested region by id", () => {
    expect(findRegion(withContainers(), "left.search")?.label).toBe("Search");
  });

  it("shows the first present child when nothing is recorded", () => {
    const tree = withContainers();
    const only = state(tree, { b: bothFilled.b });
    expect(activeChild(only, findRegion(tree, "left")!)?.id).toBe("left.search");
  });

  it("honours the recorded choice while that child is present", () => {
    const tree = selectChild(withContainers(), "left", "left.explorer");
    const both = state(tree, bothFilled);
    expect(activeChild(both, findRegion(tree, "left")!)?.id).toBe("left.explorer");
  });

  it("falls back when the recorded choice is no longer present", () => {
    const tree = selectChild(withContainers(), "left", "left.explorer");
    const only = state(tree, { b: bothFilled.b });
    expect(activeChild(only, findRegion(tree, "left")!)?.id).toBe("left.search");
  });

  it("has no active child when it holds views instead", () => {
    const plain = state();
    expect(activeChild(plain, findRegion(plain.tree, "left")!)).toBeNull();
  });

  it("hands the selector's box to the child it shows", () => {
    const tree = selectChild(withContainers(), "left", "left.search");
    const sizes = resolveSizes(state(tree, bothFilled), 1000, 800);
    expect(sizes.get("left")).toEqual(sizes.get("left.search"));
  });

  it("needs the widest child's room, since only one is shown", () => {
    const tree = setRegionChildren(defaultTree(), "left", [
      regionNode("left.a", 0, { min: 120 }),
      regionNode("left.b", 0, { min: 340 }),
    ]);
    expect(subtreeMin(findRegion(tree, "left")!)).toBe(340);
  });

  it("shows the container a view is placed into", () => {
    const next = place(state(withContainers()), "v", "left.search");
    expect(findRegion(next.tree, "left")?.active).toBe("left.search");
  });

  it("keeps a view placed in a nested container reachable by its own region", () => {
    const next = place(state(withContainers()), "v", "left.search");
    expect(visibleViews(next, "left.search")).toEqual(["v"]);
    expect(visibleViews(next, "left")).toEqual([]);
  });
});
