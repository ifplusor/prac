import { describe, expect, it } from "vite-plus/test";

import type { WindowGroupBindingsPort } from "./window-manager.js";
import {
  WindowManager,
  type WindowGroupRuntime,
  type WindowRuntimeHandle,
} from "./window-manager.js";

/** A group runtime with the membership API the manager speaks. */
class FakeRuntime implements WindowGroupRuntime {
  readonly #order: string[] = [];
  #active: string | undefined;

  constructor(readonly id: string) {}

  get state(): { readonly order: readonly string[]; readonly active?: string } {
    return {
      order: [...this.#order],
      ...(this.#active === undefined ? {} : { active: this.#active }),
    };
  }

  add(window: WindowRuntimeHandle): void {
    this.#order.push(window.id);
  }

  remove(windowId: string): void {
    const index = this.#order.indexOf(windowId);
    if (index !== -1) this.#order.splice(index, 1);
    if (this.#active === windowId) this.#active = this.#order[0];
  }

  select(windowId: string | undefined): void {
    this.#active = windowId;
  }
}

/** The frame projection, stubbed: the manager's tests are about membership. */
const fakeBindings = (): WindowGroupBindingsPort =>
  ({
    register: () => ({}) as never,
    registerContent: () => ({}) as never,
    barItems: () => [],
    contentFor: () => undefined,
    get: () => undefined,
    unregister: () => {},
    dispose: () => {},
  }) satisfies WindowGroupBindingsPort;

const handle = (id: string): WindowRuntimeHandle => ({ id });

describe("WindowManager", () => {
  it("registers groups and reports the group that holds a window", () => {
    const manager = new WindowManager(fakeBindings());
    const left = new FakeRuntime("left");
    const right = new FakeRuntime("right");
    manager.register(left, "left");
    manager.register(right, "right");
    manager.open("left", handle("a"));
    manager.open("right", handle("b"));
    expect(manager.groupOf("a")?.id).toBe("left");
    expect(manager.groupOf("b")?.id).toBe("right");
    expect(manager.groups()).toEqual(["left", "right"]);
    expect(manager.windows("left")).toEqual(["a"]);
  });

  it("opens a window as the group's active member", () => {
    const manager = new WindowManager(fakeBindings());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    manager.open("left", handle("b"));
    expect(group.state.order).toEqual(["a", "b"]);
    expect(group.state.active).toBe("b");
  });

  it("closes a window wherever it is", () => {
    const manager = new WindowManager(fakeBindings());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    expect(manager.close("a")).toBe(true);
    expect(manager.close("a")).toBe(false);
    expect(group.state.order).toEqual([]);
  });

  it("moves a window between groups without losing its handle", () => {
    const manager = new WindowManager(fakeBindings());
    const left = new FakeRuntime("left");
    const right = new FakeRuntime("right");
    manager.register(left, "left");
    manager.register(right, "right");
    manager.open("left", handle("a"));
    expect(manager.move("a", "right")).toBe(true);
    expect(left.state.order).toEqual([]);
    expect(right.state.order).toEqual(["a"]);
    expect(manager.groupOf("a")?.id).toBe("right");
  });

  it("refuses to move a window that is not held, or into itself", () => {
    const manager = new WindowManager(fakeBindings());
    const left = new FakeRuntime("left");
    manager.register(left, "left");
    expect(manager.move("missing", "left")).toBe(false);
    manager.open("left", handle("a"));
    expect(manager.move("a", "left")).toBe(false);
  });

  it("activates a held window", () => {
    const manager = new WindowManager(fakeBindings());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    manager.open("left", handle("b"));
    expect(manager.activate("a")).toBe(true);
    expect(group.state.active).toBe("a");
    expect(manager.activate("missing")).toBe(false);
  });

  it("rejects a duplicate group and an unknown group", () => {
    const manager = new WindowManager(fakeBindings());
    manager.register(new FakeRuntime("left"), "left");
    expect(() => manager.register(new FakeRuntime("left"), "left")).toThrow(/already registered/);
    expect(() => manager.open("missing", handle("a"))).toThrow(/unknown group/);
  });

  it("forgets the windows of an unregistered group", () => {
    const manager = new WindowManager(fakeBindings());
    manager.register(new FakeRuntime("left"), "left");
    manager.open("left", handle("a"));
    manager.unregister("left");
    expect(manager.groupOf("a")).toBeUndefined();
    expect(manager.groups()).toEqual([]);
  });
});
