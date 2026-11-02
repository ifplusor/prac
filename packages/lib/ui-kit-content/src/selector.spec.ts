import { describe, expect, it } from "vite-plus/test";
import { drawsRegionBar, regionNode, resolveSizes, setRegionSelector } from "./model.js";
import { findRegion } from "prac-ui-kit-layout";
import type { RegionSelector } from "prac-ui-kit-layout";
import type { LayoutState } from "./placement.js";

/**
 * How a region presents its **choice among its children**.
 *
 * The selector is state, not styling: only a strip drawn **inside** the region may cost the
 * allocation height. A dock rail lives outside the region, and `none` draws nothing, so both must
 * hand the active child the region's whole box — a shell that merely hides a strip with CSS cannot
 * tell the allocation that, which is the bug this kind exists to prevent.
 */
function state(selector?: RegionSelector): LayoutState {
  const left = regionNode("left", 280, {
    children: [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
    active: "a",
    ...(selector === undefined ? {} : { selector }),
  });
  return {
    viewportWidth: 1000,
    viewportHeight: 800,
    tree: { type: "split", id: "root", dir: "row", children: [left] },
    items: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
}

const childHeight = (layout: LayoutState): number =>
  resolveSizes(layout, layout.viewportWidth, layout.viewportHeight).get("a")?.height ?? -1;

describe("region selector", () => {
  it("reserves the strip for a title selector", () => {
    expect(drawsRegionBar(findRegion(state("title").tree, "left")!)).toBe(true);
    expect(childHeight(state("title"))).toBe(780);
  });

  it("reserves nothing for a rail: the rail is outside the region", () => {
    expect(drawsRegionBar(findRegion(state("rail").tree, "left")!)).toBe(false);
    expect(childHeight(state("rail"))).toBe(800);
  });

  it("reserves nothing for none", () => {
    expect(drawsRegionBar(findRegion(state("none").tree, "left")!)).toBe(false);
    expect(childHeight(state("none"))).toBe(800);
  });

  it("keeps the pre-dock default: a strip when there is more than one child", () => {
    expect(childHeight(state())).toBe(780);
  });

  it("draws nothing for a region with a single child", () => {
    const single = state();
    single.tree = {
      type: "split",
      id: "root",
      dir: "row",
      children: [
        regionNode("left", 280, {
          children: [regionNode("a", 0, { flex: true })],
          active: "a",
        }),
      ],
    };
    expect(drawsRegionBar(findRegion(single.tree, "left")!)).toBe(false);
    expect(childHeight(single)).toBe(800);
  });

  it("sets the kind on the region and is idempotent", () => {
    const once = setRegionSelector(state("rail").tree, "left", "title");
    expect(findRegion(once, "left")?.selector).toBe("title");
    expect(setRegionSelector(once, "left", "title")).toBe(once);
  });
});
