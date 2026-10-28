import { describe, expect, it } from "vite-plus/test";

import { WindowGroup, type WindowRecord } from "./window.js";

const window = (id: string): WindowRecord => ({
  id,
  appId: "editor",
  kind: "application",
  title: id,
});

describe("WindowGroup", () => {
  it("opens windows and activates the first", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.open(window("b"));
    expect(group.state.order).toEqual(["a", "b"]);
    expect(group.state.active).toBe("a");
  });

  it("activates an open window", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.open(window("b"));
    group.activate("b");
    expect(group.activeWindow?.id).toBe("b");
  });

  it("falls back to the next window when active closes", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.open(window("b"));
    group.open(window("c"));
    group.activate("b");
    group.close("b");
    expect(group.state.active).toBe("c");
  });

  it("falls back to the previous window at the end", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.open(window("b"));
    group.close("b");
    expect(group.state.active).toBe("a");
  });

  it("rejects duplicate and unknown windows", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    expect(() => group.open(window("a"))).toThrow(/already open/);
    expect(() => group.activate("b")).toThrow(/unknown window/);
  });

  it("reorders only a complete permutation", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.open(window("b"));
    group.reorder(["b", "a"]);
    expect(group.state.order).toEqual(["b", "a"]);
    expect(() => group.reorder(["a"])).toThrow(/length mismatch/);
  });

  it("becomes empty after the last close", () => {
    const group = new WindowGroup("g");
    group.open(window("a"));
    group.close("a");
    expect(group.empty).toBe(true);
    expect(group.state.active).toBeUndefined();
  });
});
