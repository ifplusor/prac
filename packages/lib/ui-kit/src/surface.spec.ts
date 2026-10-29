import { describe, expect, it } from "vite-plus/test";

import { SurfaceRegistry, type Surface } from "./surface.js";

const group = { id: "group" } as const;
const surface = (): Surface<typeof group> => ({
  kind: "window-group",
  group,
  dispose: () => undefined,
});

describe("SurfaceRegistry", () => {
  it("creates a registered kind and disposes idempotently", () => {
    const registry = new SurfaceRegistry<typeof group>();
    const registration = registry.register("window-group", { create: surface });
    expect(registry.create("window-group", { nodeId: "stage" }).group).toBe(group);
    registration.dispose();
    registration.dispose();
    expect(registry.has("window-group")).toBe(false);
  });

  it("rejects duplicate kinds", () => {
    const registry = new SurfaceRegistry<typeof group>();
    registry.register("widget-board", { create: surface });
    expect(() => registry.register("widget-board", { create: surface })).toThrow(
      "surface kind already registered",
    );
  });

  it("keeps a newer registration when an older one disposes", () => {
    const registry = new SurfaceRegistry<typeof group>();
    const first = registry.register("window-group", { create: surface });
    first.dispose();
    const second = registry.register("window-group", { create: surface });
    first.dispose();
    expect(registry.has("window-group")).toBe(true);
    second.dispose();
    expect(registry.has("window-group")).toBe(false);
  });
});
