import { describe, expect, it } from "vite-plus/test";

import type { GeometryNode, LayoutNode, RegionNode } from "./geometry.js";
import {
  findNode,
  findRegion,
  findSplit,
  firstRegionId,
  freshNodeId,
  replaceNode,
  subtreeMin,
} from "./tree.js";

const region = (id: string, extra: Partial<RegionNode> = {}): RegionNode => ({
  type: "region",
  id,
  size: 100,
  flex: false,
  collapsed: false,
  cachedSize: 100,
  min: 10,
  ...extra,
});

const tree = (): GeometryNode => ({
  type: "split",
  id: "root",
  dir: "row",
  children: [
    region("left"),
    { type: "split", id: "right", dir: "column", children: [region("a"), region("b")] },
  ],
});

describe("tree", () => {
  it("finds regions, splits and the first region", () => {
    expect(findRegion(tree(), "a")?.id).toBe("a");
    expect(findSplit(tree(), "right")?.id).toBe("right");
    expect(findNode(tree(), "root")?.type).toBe("split");
    expect(firstRegionId(tree())).toBe("left");
  });

  it("replaces only the matching node", () => {
    const next = replaceNode(tree(), "a", (node) => ({ ...node, id: "renamed" }));
    expect(findNode(next, "a")).toBeNull();
    expect(findNode(next, "renamed")?.type).toBe("region");
    const original = tree();
    expect(replaceNode(original, "missing", (node) => node)).toBe(original);
  });

  it("generates an id that is not in the tree", () => {
    let value = 0;
    const id = freshNodeId(tree(), "region", () => value++);
    expect(findNode(tree(), id)).toBeNull();
  });

  it("sums a split's minima and takes a selector's widest child", () => {
    const state = tree();
    expect(subtreeMin(state)).toBe(30);
    const selector = region("selector", {
      min: 50,
      children: [region("one", { min: 10 }), region("two", { min: 80 })],
    }) as LayoutNode;
    expect(subtreeMin(selector)).toBe(80);
  });
});
