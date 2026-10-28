import { describe, expect, it } from "vite-plus/test";

import { WidgetRegistry, type WidgetDefinition } from "./widget.js";

function definition(id: string): WidgetDefinition {
  return {
    id,
    source: "test",
    hostKind: "react",
    title: id,
    multiplicity: "single",
  };
}

describe("WidgetRegistry", () => {
  it("registers and looks up by id", () => {
    const registry = new WidgetRegistry();
    registry.register(definition("a"));
    expect(registry.lookup("a")?.title).toBe("a");
    expect(registry.has("a")).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const registry = new WidgetRegistry();
    registry.register(definition("a"));
    expect(() => registry.register(definition("a"))).toThrow(/already registered/);
  });

  it("unregisters only its own definition", () => {
    const registry = new WidgetRegistry();
    const first = registry.register(definition("a"));
    registry.register(definition("b"));
    first.dispose();
    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(true);
  });

  it("lists in registration order", () => {
    const registry = new WidgetRegistry();
    registry.register(definition("a"));
    registry.register(definition("b"));
    expect(registry.list().map((item) => item.id)).toEqual(["a", "b"]);
  });
});
