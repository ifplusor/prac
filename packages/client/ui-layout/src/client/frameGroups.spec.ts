import { describe, expect, it } from "vite-plus/test";
import { defaultTree } from "./model.js";
import type { LayoutState } from "./contract.js";
import type { LayoutStore } from "./store.js";
import { View } from "./view.js";
import { ViewGroup } from "./viewGroup.js";
import { ViewGroupHost } from "./frameGroups.js";

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

describe("ViewGroupHost", () => {
  it("registers one group in one region and projects its views", () => {
    const store = memoryStore();
    const host = new ViewGroupHost(store);
    const group = new ViewGroup("g1");
    group.add(new View("v1"));

    const frameGroup = host.register(group, "left");

    expect(frameGroup.regionId).toBe("left");
    expect(store.get().views["v1"]).toBeDefined();
    expect(host.get("g1")).toBe(frameGroup);
  });

  it("rejects duplicate groups and regions", () => {
    const host = new ViewGroupHost(memoryStore());
    host.register(new ViewGroup("g1"), "left");

    expect(() => host.register(new ViewGroup("g1"), "right")).toThrow(/already registered/);
    expect(() => host.register(new ViewGroup("g2"), "left")).toThrow(/already hosts/);
    expect(() => host.register(new ViewGroup("g3"), "missing")).toThrow(/unknown region/);
  });

  it("can register a fresh group after the old one leaves", () => {
    const store = memoryStore();
    const host = new ViewGroupHost(store);
    host.register(new ViewGroup("g1"), "left");
    host.unregister("g1");

    const next = new ViewGroup("g1");
    next.add(new View("v2"));
    host.register(next, "left");

    expect(store.get().views["v2"]).toBeDefined();
    expect(host.get("g1")?.group).toBe(next);
  });

  it("unregisters without disposing the group", () => {
    const store = memoryStore();
    const host = new ViewGroupHost(store);
    const group = new ViewGroup("g1");
    group.add(new View("v1"));
    host.register(group, "left");

    host.unregister("g1");

    expect(host.get("g1")).toBeUndefined();
    expect(store.get().views["v1"]).toBeUndefined();
    expect(group.state.order).toEqual(["v1"]);
  });
});
