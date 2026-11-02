import { describe, expect, it } from "vite-plus/test";

import { RegionContentRegistry, type RegionContent } from "./regionContent.js";

const group = { id: "group" } as const;
const content = (): RegionContent<typeof group> => ({
  kind: "window-group",
  group,
  dispose: () => undefined,
});

describe("RegionContentRegistry", () => {
  it("creates a registered kind and disposes idempotently", () => {
    const registry = new RegionContentRegistry<typeof group>();
    const registration = registry.register("window-group", { create: content });
    expect(registry.create("window-group", { nodeId: "stage" }).group).toBe(group);
    registration.dispose();
    registration.dispose();
    expect(registry.has("window-group")).toBe(false);
  });

  it("rejects duplicate kinds", () => {
    const registry = new RegionContentRegistry<typeof group>();
    registry.register("widget-board", { create: content });
    expect(() => registry.register("widget-board", { create: content })).toThrow(
      "content kind already registered",
    );
  });

  it("keeps a newer registration when an older one disposes", () => {
    const registry = new RegionContentRegistry<typeof group>();
    const first = registry.register("window-group", { create: content });
    first.dispose();
    const second = registry.register("window-group", { create: content });
    first.dispose();
    expect(registry.has("window-group")).toBe(true);
    second.dispose();
    expect(registry.has("window-group")).toBe(false);
  });
});
