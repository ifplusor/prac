import { describe, expect, it } from "vite-plus/test";
import { defaultTree } from "./model.js";
import type { LayoutState } from "./contract.js";
import type { LayoutStore } from "./store.js";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";
import { ViewGroupLayoutBridge } from "./frameBridge.js";

function memoryStore(): LayoutStore {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    views: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
  return {
    get: () => state,
    subscribe: () => () => {},
    update: (updater) => {
      state = updater(state);
    },
    requestCloseView: () => {},
  };
}

describe("ViewGroupLayoutBridge", () => {
  it("projects membership, order and active", () => {
    const store = memoryStore();
    const group = new ViewGroup("g1", "select");
    group.add(new View("v1"));
    group.add(new View("v2"));
    const bridge = new ViewGroupLayoutBridge(group, store, "left");

    expect(bridge.regionId).toBe("left");
    expect(store.get().views["v1"]?.region).toMatch(/^left/);
    expect(store.get().views["v2"]?.region).toMatch(/^left/);
    expect(store.get().views["v1"]?.front).toBe(true);

    group.select("v2");
    expect(store.get().views["v1"]?.front).toBe(false);
    expect(store.get().views["v2"]?.front).toBe(true);

    group.reorder(["v2", "v1"]);
    expect(store.get().views["v2"]?.order).toBe(0);
    expect(store.get().views["v1"]?.order).toBe(1);
  });

  it("removes views that leave the group and on dispose", () => {
    const store = memoryStore();
    const group = new ViewGroup("g1");
    group.add(new View("v1"));
    const bridge = new ViewGroupLayoutBridge(group, store, "left");

    group.remove("v1");
    expect(store.get().views["v1"]).toBeUndefined();

    group.add(new View("v2"));
    expect(store.get().views["v2"]).toBeDefined();
    bridge.dispose();
    expect(store.get().views["v2"]).toBeUndefined();
  });
});
