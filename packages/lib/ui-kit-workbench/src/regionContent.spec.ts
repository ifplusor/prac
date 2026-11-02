import { describe, expect, it } from "vite-plus/test";

import { RegionContentRegistry, type RegionContent } from "./regionContent.js";

const content = (kind: "window-group" | "widget-board"): RegionContent<{ id: string }> =>
  ({
    kind,
    group: { id: `${kind}-group` },
    dispose: () => undefined,
  }) as unknown as RegionContent<{ id: string }>;

describe("RegionContentRegistry", () => {
  it("creates content only after its kind is registered", () => {
    const registry = new RegionContentRegistry<{ id: string }>();
    expect(registry.has("window-group")).toBe(false);
    expect(() => registry.create("window-group", { nodeId: "stage" })).toThrow(
      "content kind not registered",
    );

    const registration = registry.register("window-group", {
      create: ({ nodeId }) => {
        const created = content("window-group");
        expect(nodeId).toBe("stage");
        return created;
      },
    });

    expect(registry.has("window-group")).toBe(true);
    expect(registry.create("window-group", { nodeId: "stage" }).group?.id).toBe(
      "window-group-group",
    );
    registration.dispose();
    expect(registry.has("window-group")).toBe(false);
  });

  it("rejects duplicate kinds and keeps the first factory after a stale dispose", () => {
    const registry = new RegionContentRegistry<{ id: string }>();
    const first = registry.register("widget-board", { create: () => content("widget-board") });
    expect(() =>
      registry.register("widget-board", { create: () => content("widget-board") }),
    ).toThrow("content kind already registered");

    first.dispose();
    first.dispose();
    expect(registry.has("widget-board")).toBe(false);
  });

  it("keeps a newer registration when an older one disposes", () => {
    const registry = new RegionContentRegistry<{ id: string }>();
    const first = registry.register("window-group", { create: () => content("window-group") });
    first.dispose();
    const second = registry.register("window-group", { create: () => content("window-group") });
    first.dispose();
    expect(registry.has("window-group")).toBe(true);
    second.dispose();
    expect(registry.has("window-group")).toBe(false);
  });
});
