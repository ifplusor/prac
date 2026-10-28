/**
 * Region sizing (S2 step 2): the bounds and the order a split shares its extent by.
 *
 * Two facts are being pinned down here. A block never leaves its own `[min, max]`, whoever is
 * dragging and however tight the frame gets. And **who gives way** is a property of the tree:
 * `priority` says so, with VS Code's meaning (`editorPart = High`, `sidebarPart = Low`) — a
 * high-priority block is resized first, so it is the first to give way and the last to be handed
 * room.
 *
 * @module prac-client-ui-frame/client/resize-regions
 */

import { describe, expect, it } from "vite-plus/test";
import {
  allocateContent,
  type Basis,
  distributeSplitEvenly,
  findRegion,
  regionNode,
  resizeBoundary,
  resolveSizes,
  setCollapsed,
  snapTargets,
} from "./model.js";
import type { Dir, LayoutNode, LayoutState, RegionNode, SplitNode } from "./contract.js";

const claim = (size: number, extra: Partial<Basis> = {}): Basis => ({
  flex: true,
  size,
  min: 40,
  max: Number.POSITIVE_INFINITY,
  priority: "normal",
  ...extra,
});

const box = (id: string, size: number, extra: Partial<RegionNode> = {}): RegionNode =>
  regionNode(id, size, { flex: true, min: 40, ...extra });

const split = (children: LayoutNode[], dir: Dir = "row"): SplitNode => ({
  type: "split",
  id: "root",
  dir,
  children,
});

const widths = (state: LayoutState, ids: readonly string[]): number[] => {
  const boxes = resolveSizes(state, 900, 600);
  return ids.map((id) => boxes.get(id)?.width ?? 0);
};

describe("allocateContent", () => {
  it("shares the leftover evenly between siblings that claim nothing", () => {
    expect(allocateContent([claim(0), claim(0)], 100)).toEqual([50, 50]);
  });

  it("stops at a child's ceiling and hands the rest on", () => {
    // An even share that fits under the ceiling stays even…
    expect(allocateContent([claim(0, { max: 60 }), claim(0)], 100)).toEqual([50, 50]);
    // …and what one cannot take, the other gets.
    expect(allocateContent([claim(0, { max: 30, min: 0 }), claim(0, { min: 0 })], 100)).toEqual([
      30, 70,
    ]);
  });

  it("keeps proportions once the children have sizes of their own", () => {
    // 600 to share, claimed 200 / 400 ⇒ the leftover keeps that 1:2 shape.
    expect(allocateContent([claim(200), claim(400)], 900)).toEqual([300, 600]);
  });

  it("raises what ended under its floor, taking the room from the sibling with spare", () => {
    const sizes = allocateContent([claim(0, { min: 80 }), claim(0, { min: 40 })], 100);
    expect(sizes[0]).toBeGreaterThanOrEqual(80);
    expect(sizes[1]).toBeGreaterThanOrEqual(40);
  });

  it("gives way by priority when there is too little room: high first, low last", () => {
    const sizes = allocateContent(
      [
        claim(100, { priority: "high", min: 20 }),
        claim(100, { priority: "normal", min: 20 }),
        claim(100, { priority: "low", min: 20 }),
      ],
      180,
    );
    // `high` is resized first: it gives way down to its floor before the next one gives anything.
    expect(sizes).toEqual([20, 60, 100]);
    const tighter = allocateContent(
      [
        claim(100, { priority: "high", min: 20 }),
        claim(100, { priority: "normal", min: 20 }),
        claim(100, { priority: "low", min: 20 }),
      ],
      120,
    );
    expect(tighter[0]).toBe(20);
    expect(tighter[1]).toBe(20);
    expect(tighter[2]).toBe(80);
  });
});

describe("resolveSizes", () => {
  it("keeps every child inside its bounds when the frame is tight", () => {
    const state: LayoutState = {
      tree: split([box("a", 0, { min: 40 }), box("b", 0, { min: 40 })]),
      views: {},
    } as unknown as LayoutState;
    // Sashes overlay the boundary; the regions share all 900.
    expect(widths(state, ["a", "b"])).toEqual([450, 450]);
  });
});

describe("resizeBoundary", () => {
  const three = (): LayoutState =>
    ({
      tree: split([box("a", 300), box("b", 300), box("c", 300)]),
      views: {},
    }) as unknown as LayoutState;

  it("distributes a drag over the whole side, in proportion", () => {
    const next = resizeBoundary(three(), "root", 1, 90);
    // The drag writes those sizes; what is drawn is them re-fitted to the frame (`resolveSizes`
    // is the only thing that decides pixels). Sashes overlay, so they consume no extent.
    expect(widths(next, ["a", "b", "c"])).toEqual([390, 255, 255]);
  });

  it("clamps the drag to what the two sides can do", () => {
    const state = {
      tree: split([box("a", 300, { max: 350 }), box("b", 300), box("c", 300)]),
      views: {},
    } as unknown as LayoutState;
    const next = resizeBoundary(state, "root", 1, 90);
    // `a` cannot take more than 50, and nothing may end up under its floor either.
    expect(widths(next, ["a", "b", "c"])).toEqual([350, 275, 275]);
  });

  it("does not move when the side that should shrink is already at its floor", () => {
    const state = {
      tree: split([box("a", 300), box("b", 40), box("c", 40)]),
      views: {},
    } as unknown as LayoutState;
    // Growing a needs b/c to shrink, and they cannot: the drag is a no-op, not a partial move.
    expect(resizeBoundary(state, "root", 1, 90)).toBe(state);
  });

  it("does not move when the side that should grow is already at its ceiling", () => {
    const state = {
      tree: split([box("a", 300, { max: 300 }), box("b", 300), box("c", 300)]),
      views: {},
    } as unknown as LayoutState;
    expect(resizeBoundary(state, "root", 1, 90)).toBe(state);
  });

  it("does not move up when the up side is already at its floor", () => {
    const state = {
      tree: split([box("a", 40), box("b", 300), box("c", 300)]),
      views: {},
    } as unknown as LayoutState;
    expect(resizeBoundary(state, "root", 1, -90)).toBe(state);
  });

  it("pushes only the neighbour in `expand`, and by priority when it must choose", () => {
    const state = {
      tree: split([
        box("a", 300),
        box("b", 300, { priority: "normal" }),
        box("c", 300, { priority: "high" }),
      ]),
      views: {},
    } as unknown as LayoutState;
    // The high-priority neighbour is considered first, so it is the one that gives way.
    expect(widths(resizeBoundary(state, "root", 1, 90, "expand"), ["a", "b", "c"])).toEqual([
      390, 300, 210,
    ]);
  });

  it("is a no-op at a split's edge and on an unknown split", () => {
    const state = three();
    expect(resizeBoundary(state, "root", 0, 90)).toBe(state);
    expect(resizeBoundary(state, "root", 3, 90)).toBe(state);
    expect(resizeBoundary(state, "nope", 0, 90)).toBe(state);
  });
});

describe("snapTargets and distributeSplitEvenly", () => {
  const state = (extra: Partial<RegionNode> = {}): LayoutState =>
    ({
      tree: split([box("a", 300, { snap: true, ...extra }), box("b", 300, { snap: true })]),
      views: {},
    }) as unknown as LayoutState;
  // What the two are actually drawn at: the split is 900 wide, less its sash.
  const drawn = new Map([
    ["a", 447.5],
    ["b", 447.5],
  ]);

  it("offers the block a drag may take away, with the threshold half its own minimum", () => {
    const targets = snapTargets(state(), "root", 1, drawn);
    expect(targets.before?.id).toBe("a");
    expect(targets.before?.side).toBe("before");
    expect(targets.before?.hidden).toBe(false);
    // Half of `a`'s floor is 20, and it is drawn at 447.5: the drag takes it away once what is left
    // would be under that.
    expect(targets.before?.half).toBe(20);
    expect(targets.before?.size).toBe(447.5);
    expect(targets.after?.id).toBe("b");
    expect(targets.after?.side).toBe("after");
    expect(targets.after?.size).toBe(447.5);
  });

  it("offers the hidden block when none on that side is visible, so a drag can bring it back", () => {
    const hidden = setCollapsed(state(), "a", true, 447.5);
    const targets = snapTargets(hidden, "root", 1, new Map([["b", 890]]));
    expect(targets.before?.id).toBe("a");
    expect(targets.before?.hidden).toBe(true);
    // It comes back at the extent it had when it went away, not at the sliver it shrank to.
    expect(findRegion(hidden.tree, "a")?.cachedSize).toBe(448);
  });

  it("evens a split out, inside every floor", () => {
    const even = distributeSplitEvenly(state(), "root", drawn);
    const [a, b] = widths(even, ["a", "b"]);
    // Rounding to whole pixels is fine; what matters is that nobody is left out.
    expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThanOrEqual(1);
  });
});
