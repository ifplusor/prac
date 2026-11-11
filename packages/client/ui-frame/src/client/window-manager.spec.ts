import { describe, expect, it } from "vite-plus/test";

import { ApplicationRegistry, type ApplicationDefinition } from "prac-ui-kit-workbench";

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
const fakeBindings = (regions: Readonly<Record<string, string>> = {}): WindowGroupBindingsPort =>
  ({
    register: () => ({}) as never,
    registerContent: () => ({}) as never,
    barItems: (regionId: string) => {
      const groupId = regions[regionId];
      return groupId === undefined ? [] : [{ groupId, regionId, label: groupId }];
    },
    snapshot: () => ({
      viewportWidth: 0,
      viewportHeight: 0,
      tree: {
        type: "region",
        id: "stage",
        size: 0,
        flex: true,
        collapsed: false,
        cachedSize: 0,
        min: 0,
      },
      items: {},
      catalogueVersion: 0,
      activePanelId: null,
    }),
    contentFor: () => undefined,
    get: () => undefined,
    unregister: () => {},
    dispose: () => {},
  }) satisfies WindowGroupBindingsPort;

const app = (
  id: string,
  overrides: Partial<ApplicationDefinition> = {},
): ApplicationDefinition => ({
  id,
  label: id,
  instances: "multi",
  content: () => () => null,
  ...overrides,
});

const handle = (id: string): WindowRuntimeHandle => ({ id });

describe("WindowManager", () => {
  it("registers groups and reports the group that holds a window", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    const left = new FakeRuntime("left");
    const right = new FakeRuntime("right");
    manager.register(left, "left");
    manager.register(right, "right");
    manager.open("left", handle("a"));
    manager.open("right", handle("b"));
    expect(manager.groupOf("a")?.id).toBe("left");
    expect(manager.groupOf("b")?.id).toBe("right");
    expect(manager.groups()).toEqual(["left", "right"]);
    expect(manager.groupWindows("left")).toEqual(["a"]);
  });

  it("opens a window as the group's active member", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    manager.open("left", handle("b"));
    expect(group.state.order).toEqual(["a", "b"]);
    expect(group.state.active).toBe("b");
  });

  it("closes a window wherever it is", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    expect(manager.close("a")).toBe(true);
    expect(manager.close("a")).toBe(false);
    expect(group.state.order).toEqual([]);
  });

  it("moves a window between groups without losing its handle", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
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
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    const left = new FakeRuntime("left");
    manager.register(left, "left");
    expect(manager.move("missing", "left")).toBe(false);
    manager.open("left", handle("a"));
    expect(manager.move("a", "left")).toBe(false);
  });

  it("activates a held window", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    const group = new FakeRuntime("left");
    manager.register(group, "left");
    manager.open("left", handle("a"));
    manager.open("left", handle("b"));
    expect(manager.activate("a")).toBe(true);
    expect(group.state.active).toBe("a");
    expect(manager.activate("missing")).toBe(false);
  });

  it("rejects a duplicate group and an unknown group", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    manager.register(new FakeRuntime("left"), "left");
    expect(() => manager.register(new FakeRuntime("left"), "left")).toThrow(/already registered/);
    expect(() => manager.open("missing", handle("a"))).toThrow(/unknown group/);
  });

  it("forgets the windows of an unregistered group", () => {
    const manager = new WindowManager(fakeBindings(), new ApplicationRegistry());
    manager.register(new FakeRuntime("left"), "left");
    manager.open("left", handle("a"));
    manager.unregister("left");
    expect(manager.groupOf("a")).toBeUndefined();
    expect(manager.groups()).toEqual([]);
  });
});

describe("WindowManager.admit", () => {
  const managerWith = (regions: Readonly<Record<string, string>> = {}) => {
    const apps = new ApplicationRegistry();
    const bindings = fakeBindings(regions);
    const manager = new WindowManager(bindings, apps);
    return { apps, bindings, manager };
  };

  it("admits a window into the group named explicitly", () => {
    const { apps, manager } = managerWith();
    apps.register(app("editor"));
    const left = new FakeRuntime("left");
    manager.register(left, "left");
    expect(manager.admit("editor", { windowId: "f1", groupId: "left" })).toBe("f1");
    expect(left.state.order).toEqual(["f1"]);
  });

  it("picks the group bound in the requested region", () => {
    const { apps, manager } = managerWith({ center: "center-group" });
    apps.register(app("editor"));
    const center = new FakeRuntime("center-group");
    manager.register(center, "center");
    expect(manager.admit("editor", { windowId: "f1", region: "center" })).toBe("f1");
    expect(center.state.order).toEqual(["f1"]);
  });

  it("refuses an unknown app", () => {
    const { manager } = managerWith();
    expect(() => manager.admit("missing", { windowId: "f1" })).toThrow(/unknown app/);
  });

  it("records a window the arrangement places directly (no group)", () => {
    const { apps, manager } = managerWith();
    apps.register(app("editor"));
    manager.admit("editor", { windowId: "f1", title: "main.ts" });
    expect(manager.windows("editor")).toEqual([{ id: "f1", appId: "editor" }]);
    expect(manager.groupOf("f1")).toBeUndefined();
  });

  it("reports app windows, their titles and their content", () => {
    const apps = new ApplicationRegistry();
    apps.register(app("editor"));
    const manager = new WindowManager(fakeBindings(), apps);
    manager.register(new FakeRuntime("center"), "center");
    manager.admit("editor", {
      windowId: "f1",
      groupId: "center",
      title: "main.ts",
      appVersion: "2",
    });
    expect(manager.ids()).toEqual(["f1"]);
    expect(manager.titleOf("f1")).toBe("main.ts");
    const resolved = manager.windowContentFor("f1");
    expect(typeof resolved).toBe("function");
    expect(resolved?.()).toBeNull();
    expect(manager.windows("editor")).toEqual([
      { id: "f1", appId: "editor", appVersion: "2", groupId: "center" },
    ]);
    manager.close("f1");
    expect(manager.ids()).toEqual([]);
    expect(manager.windowContentFor("f1")).toBeUndefined();
  });

  it("hands the host's renderer to an app whose body is a host panel", () => {
    const apps = new ApplicationRegistry();
    const render = (_slot: string, _props: Record<string, unknown>, _options?: unknown) => "panel";
    apps.register(
      app("host", { content: (_windowId, renderSlot) => () => renderSlot?.("main", {}) ?? null }),
    );
    const manager = new WindowManager(fakeBindings(), apps);
    manager.admit("host", { windowId: "h1" });
    const resolved = manager.windowContentFor("h1", render as never);
    expect(resolved?.()).toBe("panel");
  });

  it("hands the source's handle to the group when one is given", () => {
    const { apps, manager } = managerWith();
    apps.register(app("editor"));
    const center = new FakeRuntime("center");
    manager.register(center, "center");
    const handle = {
      id: "f1",
      released: false,
      release() {
        this.released = true;
      },
    };
    manager.admit("editor", { windowId: "f1", groupId: "center", handle });
    expect(center.state.order).toEqual(["f1"]);
    manager.close("f1");
    expect(handle.released).toBe(false);
  });

  it("drops a group-less window on close, leaving no stale catalogue entry", () => {
    const { apps, manager } = managerWith();
    apps.register(app("editor"));
    manager.admit("editor", { windowId: "p0", title: "alpha" });
    manager.admit("editor", { windowId: "p1", title: "alpha" });
    expect(manager.ids()).toEqual(["p0", "p1"]);
    manager.close("p0");
    expect(manager.ids()).toEqual(["p1"]);
    expect(manager.titleOf("p0")).toBeUndefined();
    expect(manager.windowContentFor("p0")).toBeUndefined();
  });

  it("reuses the single window of a single-instance app", () => {
    const { apps, manager } = managerWith();
    apps.register(app("chat", { instances: "single" }));
    const center = new FakeRuntime("center");
    manager.register(center, "center");
    manager.admit("chat", { windowId: "dsh:main:conversation", groupId: "center" });
    expect(manager.admit("chat", { windowId: "chat/second", groupId: "center" })).toBe(
      "dsh:main:conversation",
    );
    expect(center.state.order).toEqual(["dsh:main:conversation"]);
  });

  it("activates a window that is already held instead of re-adding it", () => {
    const { apps, manager } = managerWith();
    apps.register(app("editor"));
    const center = new FakeRuntime("center");
    manager.register(center, "center");
    manager.admit("editor", { windowId: "f1", groupId: "center" });
    manager.admit("editor", { windowId: "f2", groupId: "center" });
    expect(center.state.active).toBe("f2");
    manager.admit("editor", { windowId: "f1", groupId: "center" });
    expect(center.state.order).toEqual(["f1", "f2"]);
    expect(center.state.active).toBe("f1");
  });
});
