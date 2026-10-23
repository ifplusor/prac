import { describe, expect, it } from "vite-plus/test";
import {
  findRegion,
  gridNode,
  isPresent,
  regionInfos,
  regionNode,
  removeRegion,
  resolveSizes,
  splitRegionWith,
} from "./model.js";
import type { LayoutState } from "./contract.js";

function state(): LayoutState {
  return {
    viewportWidth: 1000,
    viewportHeight: 800,
    tree: gridNode("stage", 2, 2, [
      regionNode("a", 0, { flex: true }),
      regionNode("b", 0, { flex: true }),
      regionNode("c", 0, { flex: true }),
      regionNode("d", 0, { flex: true }),
    ]),
    views: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
}

describe("grid node", () => {
  it("is a layout node whose cells are findable regions", () => {
    const layout = state();
    expect(findRegion(layout.tree, "a")?.id).toBe("a");
    expect(regionInfos(layout.tree).map((region) => region.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is present when a cell is present", () => {
    const layout = state();
    expect(isPresent(layout, layout.tree)).toBe(true);
  });

  it("flows a partial 2×2 grid without shrinking a lone cell", () => {
    const one = state();
    one.tree = gridNode("stage", 2, 2, [regionNode("a", 0, { flex: true })]);
    expect(resolveSizes(one, 1000, 800).get("a")).toEqual({ width: 1000, height: 800 });

    const two = state();
    two.tree = gridNode("stage", 2, 2, [
      regionNode("a", 0, { flex: true }),
      regionNode("b", 0, { flex: true }),
    ]);
    expect(resolveSizes(two, 1000, 800).get("a")).toEqual({ width: 500, height: 800 });

    const three = state();
    three.tree = gridNode("stage", 2, 2, [
      regionNode("a", 0, { flex: true }),
      regionNode("b", 0, { flex: true }),
      regionNode("c", 0, { flex: true }),
    ]);
    const sizes = resolveSizes(three, 1000, 800);
    expect(sizes.get("a")).toEqual({ width: 1000 / 3, height: 800 });
    expect(sizes.get("c")).toEqual({ width: 1000 / 3, height: 800 });
  });

  it("allocates each cell a box", () => {
    const layout = state();
    const sizes = resolveSizes(layout, 1000, 800);
    expect(sizes.get("a")).toEqual({ width: 500, height: 400 });
    expect(sizes.get("d")).toEqual({ width: 500, height: 400 });
  });

  it("splits and removes a cell without losing the grid", () => {
    const layout = state();
    const split = splitRegionWith(layout, "a", "right", "split-a", "new-a");
    expect(findRegion(split.tree, "new-a")).not.toBeNull();
    expect(split.tree.type).toBe("grid");

    const removed = removeRegion(split, "new-a");
    expect(findRegion(removed.tree, "new-a")).toBeNull();
    expect(removed.tree.type).toBe("grid");
  });

  it("can add a cell when the caller asks for grid cells", () => {
    const layout = state();
    layout.tree = gridNode("stage", 1, 3, [regionNode("a", 0, { flex: true })]);
    const next = splitRegionWith(layout, "a", "right", "split-a", "new-a", {
      gridCells: true,
    });
    expect(next.tree.type).toBe("grid");
    if (next.tree.type === "grid") {
      expect(next.tree.children.map((child) => child.id)).toEqual(["a", "new-a"]);
    }
  });

  it("honours explicit placements and spans", () => {
    const tree = gridNode(
      "stage",
      2,
      2,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      {
        placements: {
          a: { row: 0, column: 0, columnSpan: 2 },
          b: { row: 1, column: 1 },
        },
      },
    );
    const layout: LayoutState = {
      viewportWidth: 1000,
      viewportHeight: 800,
      tree,
      views: {},
      catalogueVersion: 0,
      activePanelId: null,
    };
    const sizes = resolveSizes(layout, 1000, 800);
    expect(sizes.get("a")).toEqual({ width: 1000, height: 400 });
    expect(sizes.get("b")).toEqual({ width: 500, height: 400 });
  });

  it("persists placements through JSON", () => {
    const tree = gridNode("stage", 2, 2, [regionNode("a", 0)], {
      placements: { a: { row: 1, column: 1, rowSpan: 1, columnSpan: 1 } },
    });
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });

  it("rejects more cells than the declared shape", () => {
    expect(() => gridNode("bad", 1, 1, [regionNode("a", 0), regionNode("b", 0)])).toThrow(
      /more cells/,
    );
  });
});
