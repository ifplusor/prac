import { describe, expect, it, vi } from "vite-plus/test";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";

describe("ViewGroup placements", () => {
  it("projects order and active state", () => {
    const group = new ViewGroup("g1", "select");
    group.add(new View("v1"));
    group.add(new View("v2"));

    expect(group.placements).toEqual([
      { viewId: "v1", groupId: "g1", order: 0, active: true, visible: true },
      { viewId: "v2", groupId: "g1", order: 1, active: false, visible: true },
    ]);
  });

  it("notifies on membership and selection changes", () => {
    const group = new ViewGroup("g1", "select");
    const listener = vi.fn();
    const off = group.onDidChange(listener);

    group.add(new View("v1"));
    group.select("v1");
    group.remove("v1");
    off();
    group.add(new View("v2"));

    expect(listener).toHaveBeenCalledTimes(3);
  });
});
