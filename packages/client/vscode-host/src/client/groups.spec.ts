import { describe, expect, it, vi } from "vite-plus/test";
import {
  VscodeGroupHost,
  planViewGroups,
  regionForLocation,
  viewGroupsFromCatalogue,
} from "./groups.js";
import {
  VscodeViewGroupDefinition,
  VSCODE_API_VERSION,
  type VscodeGroupRuntime,
  type VscodeViewGroup,
} from "./resources.js";

function groupResource(): VscodeViewGroup {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "ViewGroup",
    metadata: { id: "g1" },
    spec: { groupKind: "container", containerId: "workbench.view.explorer", title: "Explorer" },
  };
}

function fakeGroup(id: string, mode: "stack" | "select" = "stack"): VscodeGroupRuntime {
  let binding: { dispose(): void } | undefined;
  return {
    id,
    state: { id, mode, order: [] },
    placements: [],
    onDidChange: () => () => {},
    setBinding: (next) => {
      binding = next;
    },
    get binding() {
      return binding;
    },
    dispose: vi.fn(),
  };
}

function definition(): VscodeViewGroupDefinition {
  return new VscodeViewGroupDefinition({
    createGroup: (id, mode) => fakeGroup(id, mode),
    createBinding: () => ({ dispose: vi.fn() }),
  });
}

describe("VscodeGroupHost", () => {
  it("materializes, binds, registers, and disposes a group", () => {
    const registerViewGroup = vi.fn();
    const unregisterViewGroup = vi.fn();
    const host = new VscodeGroupHost({
      layout: { registerViewGroup, unregisterViewGroup },
      definition: definition(),
    });

    const group = host.add(groupResource(), "left");

    expect(group.id).toBe("g1");
    expect(registerViewGroup).toHaveBeenCalledWith(group, "left");
    expect(group.binding).toBeDefined();

    host.remove("g1");
    expect(unregisterViewGroup).toHaveBeenCalledWith("g1");
  });

  it("does not keep a group when registration fails", () => {
    const host = new VscodeGroupHost({
      layout: {
        registerViewGroup: () => {
          throw new Error("no region");
        },
        unregisterViewGroup: () => {},
      },
      definition: definition(),
    });

    expect(() => host.add(groupResource(), "missing")).toThrow(/no region/);
  });
});

describe("viewGroupsFromCatalogue", () => {
  it("creates one stable group per container", () => {
    const groups = viewGroupsFromCatalogue([
      { containerId: "a", containerTitle: "A" },
      { containerId: "a", containerTitle: "A" },
      { containerId: "b" },
      {},
    ]);

    expect(groups.map((group) => group.metadata.id)).toEqual(["vscode:group:a", "vscode:group:b"]);
    expect(groups[0]?.spec.title).toBe("A");
  });

  it("plans groups by location and falls back to the first region", () => {
    const planned = planViewGroups(
      [
        {
          containerId: "a",
          containerTitle: "A",
          location: "sidebar",
          view: "v",
          appId: "a",
          title: "A",
          source: "view",
        },
        {
          containerId: "b",
          containerTitle: "B",
          location: "panel",
          view: "v",
          appId: "b",
          title: "B",
          source: "view",
        },
      ],
      ["left", "bottom"],
    );

    expect(planned.find((item) => item.resource.spec.containerId === "a")?.regionId).toBe("left");
    expect(planned.find((item) => item.resource.spec.containerId === "b")?.regionId).toBe("bottom");
  });

  it("maps locations to default frame regions", () => {
    expect(regionForLocation("stage")).toBe("center");
    expect(regionForLocation("panel")).toBe("bottom");
    expect(regionForLocation("auxiliarybar")).toBe("right");
    expect(regionForLocation("sidebar")).toBe("left");
  });
});
