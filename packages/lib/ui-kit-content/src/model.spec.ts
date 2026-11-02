import { describe, expect, it } from "vite-plus/test";

import type { LayoutState } from "./placement.js";
import { ensureView, place, regionNode } from "./model.js";
import { visibleViews } from "./renderModel.js";

const empty = (): LayoutState => ({
  viewportWidth: 0,
  viewportHeight: 0,
  tree: regionNode("root", 0, { flex: true }),
  views: {},
  catalogueVersion: 0,
  activePanelId: null,
});

describe("generic model", () => {
  it("creates a bare placement without a product kind", () => {
    const record = ensureView(empty(), "a");
    expect(record.region).toBe("root");
    expect(record.hidden).toBe(true);
    expect(record.kind).toBeUndefined();
  });

  it("places an item and lists it as visible", () => {
    const state = place(empty(), "a", "root");
    expect(state.views.a?.region).toBe("root");
    expect(state.views.a?.hidden).toBe(false);
    expect(visibleViews(state, "root")).toEqual(["a"]);
  });
});
