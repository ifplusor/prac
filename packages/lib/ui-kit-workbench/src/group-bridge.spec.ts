import { describe, expect, it } from "vite-plus/test";
import { defaultTree, place } from "./model.js";
import type { LayoutState } from "./contract.js";
import type { LayoutStore } from "./store.js";
import { TestGroup } from "./test-group.js";
import { WindowGroupLayoutBridge } from "./group-bridge.js";

function memoryStore(): LayoutStore {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    items: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
  return {
    get: () => state,
    subscribe: () => () => {},
    update: (updater) => {
      state = updater(state);
    },
    requestCloseItem: () => {},
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
    expect(store.get().items["v1"]?.region).toMatch(/^left/);
    expect(store.get().items["v2"]?.region).toMatch(/^left/);
    expect(store.get().items["v1"]?.front).toBe(true);

    group.select("v2");
    expect(store.get().items["v1"]?.front).toBe(false);
    expect(store.get().items["v2"]?.front).toBe(true);

    group.reorder(["v2", "v1"]);
    expect(store.get().items["v2"]?.order).toBe(0);
    expect(store.get().items["v1"]?.order).toBe(1);
  });

  it("moves an existing placement instead of creating a second record", () => {
    const store = memoryStore();
    store.update((state) => place(state, "v1", "right"));
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    new WindowGroupLayoutBridge(group, store, "left");

    expect(Object.keys(store.get().items)).toEqual(["v1"]);
    expect(store.get().items["v1"]?.region).toMatch(/^left/);
  });

  it("does not unhide a view when the group changes", () => {
    const store = memoryStore();
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    const bridge = new WindowGroupLayoutBridge(group, store, "left");
    store.update((state) => ({
      ...state,
      items: { ...state.items, v1: { ...state.items["v1"]!, hidden: true } },
    }));

    group.add({ id: "v2" });
    bridge.sync();

    expect(store.get().items["v1"]?.hidden).toBe(true);
  });

  it("removes items that leave the group and on dispose", () => {
    const store = memoryStore();
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    const bridge = new WindowGroupLayoutBridge(group, store, "left");

    group.remove("v1");
    expect(store.get().items["v1"]).toBeUndefined();

    group.add({ id: "v2" });
    expect(store.get().items["v2"]).toBeDefined();
    bridge.dispose();
    expect(store.get().items["v2"]).toBeUndefined();
  });
});
