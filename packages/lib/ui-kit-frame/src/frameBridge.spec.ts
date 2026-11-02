import { describe, expect, it } from "vite-plus/test";
import { defaultTree, place } from "./model.js";
import type { LayoutState } from "./contract.js";
import type { LayoutStore } from "./store.js";
import { TestGroup } from "./testGroup.js";
import { WindowGroupLayoutBridge } from "./frameBridge.js";

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

describe("WindowGroupLayoutBridge", () => {
  it("projects membership, order and active", () => {
    const store = memoryStore();
    const group = new TestGroup("g1", "select");
    group.add({ id: "v1" });
    group.add({ id: "v2" });
    const bridge = new WindowGroupLayoutBridge(group, store, "left");

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

  it("moves an existing placement instead of creating a second record", () => {
    const store = memoryStore();
    store.update((state) => place(state, "v1", "right"));
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    new WindowGroupLayoutBridge(group, store, "left");

    expect(Object.keys(store.get().views)).toEqual(["v1"]);
    expect(store.get().views["v1"]?.region).toMatch(/^left/);
  });

  it("does not unhide a view when the group changes", () => {
    const store = memoryStore();
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    const bridge = new WindowGroupLayoutBridge(group, store, "left");
    store.update((state) => ({
      ...state,
      views: { ...state.views, v1: { ...state.views["v1"]!, hidden: true } },
    }));

    group.add({ id: "v2" });
    bridge.sync();

    expect(store.get().views["v1"]?.hidden).toBe(true);
  });

  it("removes views that leave the group and on dispose", () => {
    const store = memoryStore();
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    const bridge = new WindowGroupLayoutBridge(group, store, "left");

    group.remove("v1");
    expect(store.get().views["v1"]).toBeUndefined();

    group.add({ id: "v2" });
    expect(store.get().views["v2"]).toBeDefined();
    bridge.dispose();
    expect(store.get().views["v2"]).toBeUndefined();
  });
});
