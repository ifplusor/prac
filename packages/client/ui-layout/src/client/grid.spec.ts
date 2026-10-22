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

  it("rejects more cells than the declared shape", () => {
    expect(() => gridNode("bad", 1, 1, [regionNode("a", 0), regionNode("b", 0)])).toThrow(
      /more cells/,
    );
  });
});
