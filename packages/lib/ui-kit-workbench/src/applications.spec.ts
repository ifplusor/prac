import { describe, expect, it } from "vite-plus/test";

import { ApplicationRegistry, type ApplicationDefinition } from "./applications.js";

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

describe("ApplicationRegistry", () => {
  it("registers, reads and lists applications in registration order", () => {
    const registry = new ApplicationRegistry();
    registry.register(app("editor"));
    registry.register(app("chat", { instances: "single" }));
    expect(registry.get("editor")?.id).toBe("editor");
    expect(registry.get("chat")?.instances).toBe("single");
    expect(registry.list().map((entry) => entry.id)).toEqual(["editor", "chat"]);
  });

  it("rejects a duplicate id", () => {
    const registry = new ApplicationRegistry();
    registry.register(app("editor"));
    expect(() => registry.register(app("editor"))).toThrow(/already registered/);
  });

  it("removes a definition through its disposer only once", () => {
    const registry = new ApplicationRegistry();
    const dispose = registry.register(app("editor"));
    dispose();
    expect(registry.get("editor")).toBeUndefined();
    expect(() => dispose()).not.toThrow();
  });

  it("keeps a replacement registration alive when an old disposer runs", () => {
    const registry = new ApplicationRegistry();
    const first = registry.register(app("editor"));
    first();
    registry.register(app("editor"));
    first();
    expect(registry.get("editor")).toBeDefined();
  });

  it("notifies subscribers on register and removal", () => {
    const registry = new ApplicationRegistry();
    let changes = 0;
    const stop = registry.onDidChange(() => (changes += 1));
    const dispose = registry.register(app("editor"));
    dispose();
    stop();
    registry.register(app("chat"));
    expect(changes).toBe(2);
  });

  it("refuses registration after dispose", () => {
    const registry = new ApplicationRegistry();
    registry.dispose();
    expect(() => registry.register(app("editor"))).toThrow(/dispose/);
  });
});
