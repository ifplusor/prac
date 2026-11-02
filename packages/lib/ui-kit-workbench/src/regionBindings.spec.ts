import { describe, expect, it, vi } from "vite-plus/test";
import { defaultTree } from "./model.js";
import type { LayoutState } from "./contract.js";
import type { LayoutStore } from "./store.js";
import type { WindowGroupActionBinding } from "./workbenchModel.js";
import { TestGroup } from "./testGroup.js";
import { WindowGroupBindings } from "./regionBindings.js";

function memoryStore(): LayoutStore {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    items: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (updater) => {
      state = updater(state);
      for (const listener of listeners) listener();
    },
    requestCloseItem: () => {},
  };
}

describe("WindowGroupBindings", () => {
  it("registers one group in one region and projects its items", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    const group = new TestGroup("g1");
    group.add({ id: "v1" });

    const frameGroup = host.register(group, "left");

    expect(frameGroup.regionId).toBe("left");
    expect(store.get().items["v1"]).toBeDefined();
    expect(host.get("g1")).toBe(frameGroup);
  });

  it("rejects duplicate groups and regions", () => {
    const host = new WindowGroupBindings(memoryStore());
    host.register(new TestGroup("g1"), "left");

    expect(() => host.register(new TestGroup("g1"), "right")).toThrow(/already registered/);
    expect(() => host.register(new TestGroup("g2"), "left")).toThrow(/already hosts/);
    expect(() => host.register(new TestGroup("g3"), "missing")).toThrow(/unknown region/);
  });

  it("projects group bar items with label and active view", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    const group = new TestGroup("g1", "select", "Explorer");
    group.add({ id: "v1" });
    host.register(group, "left");

    expect(host.barItems("left")).toEqual([
      { groupId: "g1", regionId: "left", label: "Explorer", active: "v1" },
    ]);
  });

  it("projects binding actions into the bar item", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    const group = new TestGroup("g1", "select", "Explorer");
    const runAction = vi.fn();
    const binding: WindowGroupActionBinding = {
      dispose: () => {},
      actions: () => [{ id: "collapse", label: "Collapse", enabled: true, checked: false }],
      runAction,
    };
    group.setBinding(binding);
    host.register(group, "left");

    const item = host.barItems("left")[0];
    expect(item?.actions).toHaveLength(1);
    item?.runAction?.("collapse");
    expect(runAction).toHaveBeenCalledWith("collapse");
  });

  it("writes a frame reorder back into the group", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    const group = new TestGroup("g1", "stack");
    group.add({ id: "v1" });
    group.add({ id: "v2" });
    host.register(group, "left");

    store.update((state) => ({
      ...state,
      items: {
        ...state.items,
        v1: { ...state.items["v1"]!, order: 1 },
        v2: { ...state.items["v2"]!, order: 0 },
      },
    }));

    expect(group.state.order).toEqual(["v2", "v1"]);
  });

  it("can register a fresh group after the old one leaves", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    host.register(new TestGroup("g1"), "left");
    host.unregister("g1");

    const next = new TestGroup("g1");
    next.add({ id: "v2" });
    host.register(next, "left");

    expect(store.get().items["v2"]).toBeDefined();
    expect(host.get("g1")?.group).toBe(next);
  });

  it("unregisters without disposing the group", () => {
    const store = memoryStore();
    const host = new WindowGroupBindings(store);
    const group = new TestGroup("g1");
    group.add({ id: "v1" });
    host.register(group, "left");

    host.unregister("g1");

    expect(host.get("g1")).toBeUndefined();
    expect(store.get().items["v1"]).toBeUndefined();
    expect(group.state.order).toEqual(["v1"]);
  });
});
