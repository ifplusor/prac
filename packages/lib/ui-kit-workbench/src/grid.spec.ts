import { describe, expect, it } from "vite-plus/test";
import {
  compactGrid,
  gridNode,
  gridPlacements,
  mergeGridCells,
  moveGridCell,
  normalizeGrids,
  normalizeItems,
  place,
  resizeGridCell,
  resizeGridTrack,
  unmergeGridCell,
  isPresent,
  regionInfos,
  regionNode,
  removeRegion,
  resolveSizes,
  splitRegionWith,
} from "prac-ui-kit-content";
import { findRegion } from "prac-ui-kit-layout";
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
    items: {},
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

  it("closes the empty track a removed grid cell leaves behind", () => {
    const layout: LayoutState = {
      ...state(),
      tree: gridNode(
        "stage",
        1,
        3,
        [
          regionNode("a", 0, { flex: true }),
          regionNode("b", 0, { flex: true }),
          regionNode("c", 0, { flex: true }),
        ],
        {
          placements: {
            a: { row: 0, column: 0 },
            b: { row: 0, column: 1 },
            c: { row: 0, column: 2 },
          },
        },
      ),
    };
    const removed = removeRegion(layout, "b");
    expect(removed.tree.type).toBe("grid");
    if (removed.tree.type !== "grid") return;
    // `c` moves back into the middle column instead of leaving it blank.
    expect(removed.tree.placements).toEqual({
      a: { row: 0, column: 0 },
      c: { row: 0, column: 1 },
    });
    expect(removed.tree.columns).toBe(2);
  });

  it("empties a grid whose last cell is removed", () => {
    const layout: LayoutState = {
      ...state(),
      tree: gridNode("stage", 1, 1, [regionNode("a", 0, { flex: true })], {
        placements: { a: { row: 0, column: 0 } },
      }),
    };
    const removed = removeRegion(layout, "a");
    expect(removed.tree.type).toBe("grid");
    if (removed.tree.type !== "grid") return;
    expect(removed.tree.children).toEqual([]);
    expect(removed.tree.placements).toEqual({});
    expect(removed.tree.rows).toBe(1);
    expect(removed.tree.columns).toBe(1);
  });

  it("heals a persisted stage that still claims a removed cell's column", () => {
    // The shape a merge followed by closing one cell left in storage:
    // `region-2` is no longer a child, but its placement still reserves the
    // second column, so the stage halves itself beside the right sidebar.
    const broken = gridNode("stage", 1, 2, [regionNode("center", 0, { flex: true })], {
      placements: {
        center: { row: 0, column: 0 },
        "region-2": { row: 0, column: 1 },
      },
      merged: {
        "merge:stage:center:region-2": {
          source: { row: 0, column: 1 },
          target: { row: 0, column: 0 },
        },
      },
    });
    const healed = normalizeGrids(broken);
    expect(healed.type).toBe("grid");
    if (healed.type !== "grid") return;
    expect(healed.columns).toBe(1);
    expect(healed.placements).toEqual({ center: { row: 0, column: 0 } });
    expect(healed.merged).toBeUndefined();
    const layout: LayoutState = { ...state(), tree: healed };
    expect(resolveSizes(layout, 1000, 800).get("center")).toEqual({ width: 1000, height: 800 });
  });

  it("moves the active window group off a cell that left the grid", () => {
    const grid = gridNode("stage", 1, 1, [regionNode("a", 0, { flex: true })], {
      placements: { a: { row: 0, column: 0 } },
      active: "center",
    });
    const compacted = compactGrid(grid);
    expect(compacted.active).toBe("a");
    const emptied = compactGrid({ ...grid, children: [] });
    expect(emptied.active).toBeUndefined();
  });

  it("lands a view in the first window group when its named group is gone", () => {
    const layout: LayoutState = {
      ...state(),
      tree: gridNode("stage", 1, 1, [regionNode("region-2", 0, { flex: true })], {
        placements: { "region-2": { row: 0, column: 0 } },
      }),
    };
    const placed = place(layout, "vscode:main:conversation", "center");
    expect(placed.items["vscode:main:conversation"]?.region).toBe("region-2");
  });

  it("re-homes a visible view whose region no longer exists", () => {
    const layout: LayoutState = {
      ...state(),
      tree: gridNode("stage", 1, 1, [regionNode("region-2", 0, { flex: true })], {
        placements: { "region-2": { row: 0, column: 0 } },
      }),
      items: {
        "vscode:main:conversation": {
          region: "center",
          order: 0,
          hidden: false,
          front: true,
          kind: "window",
        },
        "vscode:file:p1:file:///a.ts": {
          region: "region-2",
          order: 0,
          hidden: false,
          front: true,
          kind: "window",
        },
        "vscode:sidebar": { region: "left", order: 0, hidden: true, kind: "window" },
      },
    };
    const normalized = normalizeItems(layout);
    expect(normalized.items["vscode:main:conversation"]?.region).toBe("region-2");
    expect(normalized.items["vscode:file:p1:file:///a.ts"]?.region).toBe("region-2");
    // Hidden items are not on screen; their next `place` overwrites the region.
    expect(normalized.items["vscode:sidebar"]?.region).toBe("left");
  });

  it("does not rewrite a grid that is already tight", () => {
    const tight = gridNode(
      "stage",
      1,
      2,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      {
        placements: {
          a: { row: 0, column: 0 },
          b: { row: 0, column: 1 },
        },
      },
    );
    expect(compactGrid(tight)).toBe(tight);
    expect(normalizeGrids(tight)).toBe(tight);
  });

  it("places split cells on the side the caller asked for", () => {
    const layout = state();
    layout.tree = gridNode("stage", 2, 2, [regionNode("a", 0, { flex: true })]);
    const right = splitRegionWith(layout, "a", "right", "s1", "b", { gridCells: true });
    expect(right.tree.type).toBe("grid");
    if (right.tree.type === "grid") {
      expect(right.tree.rows).toBe(1);
      expect(right.tree.columns).toBe(2);
      expect(right.tree.placements).toMatchObject({
        a: { row: 0, column: 0 },
        b: { row: 0, column: 1 },
      });
    }
    const left = splitRegionWith(right, "a", "left", "s2", "c", { gridCells: true });
    if (left.tree.type === "grid") {
      expect(left.tree.placements).toMatchObject({
        c: { row: 0, column: 0 },
        a: { row: 0, column: 1 },
        b: { row: 0, column: 2 },
      });
    }
    const down = splitRegionWith(left, "a", "down", "s3", "d", { gridCells: true });
    if (down.tree.type === "grid") {
      expect(down.tree.placements).toMatchObject({
        c: { row: 0, column: 0 },
        a: { row: 0, column: 1 },
        b: { row: 0, column: 2 },
        d: { row: 1, column: 1 },
      });
    }
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
      items: {},
      catalogueVersion: 0,
      activePanelId: null,
    };
    const sizes = resolveSizes(layout, 1000, 800);
    expect(sizes.get("a")).toEqual({ width: 1000, height: 400 });
    expect(sizes.get("b")).toEqual({ width: 500, height: 400 });
  });

  it("moves a cell by swapping placements", () => {
    const layout = state();
    const next = moveGridCell(layout.tree, "stage", "a", "d");
    expect(next.type).toBe("grid");
    if (next.type !== "grid") return;
    expect(gridPlacements(next)).toMatchObject({
      a: { row: 1, column: 1 },
      d: { row: 0, column: 0 },
    });
    expect(resolveSizes({ ...layout, tree: next }, 1000, 800).get("a")).toEqual({
      width: 500,
      height: 400,
    });
  });

  it("resizes a lone cell and refuses an overlapping span", () => {
    const one = state();
    one.tree = gridNode("stage", 2, 2, [regionNode("a", 0, { flex: true })]);
    const grown = resizeGridCell(one.tree, "stage", "a", 2, 2);
    expect(resolveSizes({ ...one, tree: grown }, 1000, 800).get("a")).toEqual({
      width: 1000,
      height: 800,
    });

    const two = state();
    two.tree = gridNode(
      "stage",
      2,
      2,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      { placements: { a: { row: 0, column: 0 }, b: { row: 0, column: 1 } } },
    );
    expect(resizeGridCell(two.tree, "stage", "a", 1, 2)).toBe(two.tree);
  });

  it("merges adjacent cells into one split cell", () => {
    const layout = state();
    layout.tree = gridNode(
      "stage",
      2,
      2,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      { placements: { a: { row: 0, column: 0 }, b: { row: 0, column: 1 } } },
    );
    const merged = mergeGridCells(layout.tree, "stage", "a", "b");
    expect(merged.type).toBe("grid");
    if (merged.type !== "grid") return;
    expect(merged.children).toHaveLength(1);
    expect(merged.children[0]?.type).toBe("split");
    if (merged.children[0]?.type !== "split") return;
    expect(merged.children[0].children.map((child) => child.id)).toEqual(["a", "b"]);
    expect(findRegion(merged, "a")).not.toBeNull();
    expect(findRegion(merged, "b")).not.toBeNull();
  });

  it("unmerges a merged cell back into two cells", () => {
    const layout = state();
    const merged = mergeGridCells(layout.tree, "stage", "a", "b");
    expect(merged.type).toBe("grid");
    if (merged.type !== "grid") return;
    const unmerged = unmergeGridCell(merged, "stage", merged.children[0]!.id);
    expect(unmerged.type).toBe("grid");
    if (unmerged.type !== "grid") return;
    expect(unmerged.children.map((child) => child.id)).toEqual(["a", "b", "c", "d"]);
    expect(unmerged.placements).toMatchObject({
      a: { row: 0, column: 0 },
      b: { row: 0, column: 1 },
    });
  });

  it("restores unequal spans when unmerging", () => {
    const layout = state();
    layout.tree = gridNode(
      "stage",
      3,
      1,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      {
        placements: {
          a: { row: 0, column: 0, rowSpan: 1 },
          b: { row: 1, column: 0, rowSpan: 2 },
        },
      },
    );
    const merged = mergeGridCells(layout.tree, "stage", "a", "b");
    expect(merged.type).toBe("grid");
    if (merged.type !== "grid") return;
    const unmerged = unmergeGridCell(merged, "stage", merged.children[0]!.id);
    if (unmerged.type !== "grid") return;
    expect(unmerged.placements).toMatchObject({
      a: { row: 0, column: 0, rowSpan: 1 },
      b: { row: 1, column: 0, rowSpan: 2 },
    });
  });

  it("unmerges nested merged cells in order", () => {
    const layout = state();
    layout.tree = gridNode(
      "stage",
      1,
      3,
      [regionNode("a", 0), regionNode("b", 0), regionNode("c", 0)],
      {
        placements: {
          a: { row: 0, column: 0 },
          b: { row: 0, column: 1 },
          c: { row: 0, column: 2 },
        },
      },
    );
    const ab = mergeGridCells(layout.tree, "stage", "a", "b");
    if (ab.type !== "grid") return;
    const abc = mergeGridCells(ab, "stage", ab.children[0]!.id, "c");
    if (abc.type !== "grid") return;
    expect(abc.children).toHaveLength(1);
    const backToAb = unmergeGridCell(abc, "stage", abc.children[0]!.id);
    if (backToAb.type !== "grid") return;
    expect(backToAb.children.map((child) => child.id)).toEqual([ab.children[0]!.id, "c"]);
    const backToAbc = unmergeGridCell(backToAb, "stage", ab.children[0]!.id);
    if (backToAbc.type !== "grid") return;
    expect(backToAbc.children.map((child) => child.id)).toEqual(["a", "b", "c"]);
  });

  it("refuses a non-adjacent merge", () => {
    const layout = state();
    layout.tree = gridNode("stage", 2, 2, [regionNode("a", 0), regionNode("b", 0)], {
      placements: { a: { row: 0, column: 0 }, b: { row: 1, column: 1 } },
    });
    expect(mergeGridCells(layout.tree, "stage", "a", "b")).toBe(layout.tree);
  });

  it("allocates by track weights and resizes the boundary", () => {
    const layout = state();
    layout.tree = gridNode(
      "stage",
      1,
      2,
      [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
      {
        placements: { a: { row: 0, column: 0 }, b: { row: 0, column: 1 } },
        columnWeights: [1, 3],
      },
    );
    const sizes = resolveSizes(layout, 1000, 800);
    expect(sizes.get("a")).toEqual({ width: 250, height: 800 });
    expect(sizes.get("b")).toEqual({ width: 750, height: 800 });

    const resized = resizeGridTrack(layout.tree, "stage", "column", 0, 125, 1000);
    const after = resolveSizes({ ...layout, tree: resized }, 1000, 800);
    expect(after.get("a")?.width).toBeGreaterThan(250);
    expect(after.get("b")?.width).toBeLessThan(750);
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
