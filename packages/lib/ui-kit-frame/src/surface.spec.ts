import { describe, expect, it } from "vite-plus/test";

import { SurfaceRegistry, type Surface } from "./surface.js";

const surface = (kind: "window-group" | "widget-board"): Surface<{ id: string }> =>
  ({
    kind,
    group: { id: `${kind}-group` },
    dispose: () => undefined,
  }) as unknown as Surface<{ id: string }>;

describe("SurfaceRegistry", () => {
  it("creates a surface only after its kind is registered", () => {
    const registry = new SurfaceRegistry<{ id: string }>();
    expect(registry.has("window-group")).toBe(false);
    expect(() => registry.create("window-group", { nodeId: "stage" })).toThrow(
      "surface kind not registered",
    );

    const registration = registry.register("window-group", {
      create: ({ nodeId }) => {
        const created = surface("window-group");
        expect(nodeId).toBe("stage");
        return created;
      },
    });

    expect(registry.has("window-group")).toBe(true);
    expect(registry.create("window-group", { nodeId: "stage" }).group.id).toBe(
      "window-group-group",
    );
    registration.dispose();
    expect(registry.has("window-group")).toBe(false);
  });

  it("rejects duplicate kinds and keeps the first factory after a stale dispose", () => {
    const registry = new SurfaceRegistry<{ id: string }>();
    const first = registry.register("widget-board", { create: () => surface("widget-board") });
    expect(() =>
      registry.register("widget-board", { create: () => surface("widget-board") }),
    ).toThrow("surface kind already registered");

    first.dispose();
    first.dispose();
    expect(registry.has("widget-board")).toBe(false);
  });

  it("keeps a newer registration when an older one disposes", () => {
    const registry = new SurfaceRegistry<{ id: string }>();
    const first = registry.register("window-group", { create: () => surface("window-group") });
    first.dispose();
    const second = registry.register("window-group", { create: () => surface("window-group") });
    first.dispose();
    expect(registry.has("window-group")).toBe(true);
    second.dispose();
    expect(registry.has("window-group")).toBe(false);
  });
});
