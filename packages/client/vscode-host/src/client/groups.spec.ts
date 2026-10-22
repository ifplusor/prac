import { describe, expect, it, vi } from "vite-plus/test";
import {
  VscodeGroupHost,
  editorGroupId,
  planViewGroups,
  regionForLocation,
  viewGroupsFromCatalogue,
} from "./groups.js";
import {
  VscodeViewDefinition,
  VscodeViewGroupDefinition,
  VSCODE_API_VERSION,
  type VscodeGroupRuntime,
  type VscodeView,
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
    add: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    reorder: vi.fn(),
    dispose: vi.fn(),
  };
}

function viewDefinition(): VscodeViewDefinition {
  return new VscodeViewDefinition({
    createView: (id) => ({
      id,
      host: undefined,
      mount: () => {},
      release: () => {},
      focus: () => {},
      dispose: () => {},
    }),
    createHost: () => ({
      mount: () => {},
      release: () => {},
      focus: () => {},
      focusable: true,
    }),
  });
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
      viewDefinition: viewDefinition(),
    });

    const group = host.add(groupResource(), "left");

    expect(group.id).toBe("g1");
    expect(registerViewGroup).toHaveBeenCalledWith(group, "left");
    expect(group.binding).toBeDefined();

    host.remove("g1");
    expect(unregisterViewGroup).toHaveBeenCalledWith("g1");
  });

  it("reconciles groups and views from a catalogue", () => {
    const host = new VscodeGroupHost({
      layout: { registerViewGroup: () => {}, unregisterViewGroup: () => {} },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });
    const entry = {
      view: "vscode:view:workbench.view.explorer",
      appId: "workbench.view.explorer",
      title: "Explorer",
      source: "view" as const,
      location: "sidebar" as const,
      containerId: "workbench.view.explorer",
    };

    host.sync([entry], ["left/container:workbench.view.explorer"]);
    expect(host.has("vscode:group:workbench.view.explorer")).toBe(true);
    expect(host.hasView(entry.view)).toBe(true);

    host.sync([], ["left/container:workbench.view.explorer"]);
    expect(host.ids()).toEqual([]);
    expect(host.viewIds()).toEqual([]);
  });

  it("can re-add a view after it disappears from the catalogue", () => {
    const host = new VscodeGroupHost({
      layout: { registerViewGroup: () => {}, unregisterViewGroup: () => {} },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });
    const entry = {
      view: "vscode:view:workbench.view.explorer",
      appId: "workbench.view.explorer",
      title: "Explorer",
      source: "view" as const,
      location: "sidebar" as const,
      containerId: "workbench.view.explorer",
    };
    const regions = ["left/container:workbench.view.explorer"];

    host.sync([entry], regions);
    host.sync([{ ...entry, containerId: "other" }], regions);
    expect(host.hasView(entry.view)).toBe(false);
    host.sync([entry], regions);

    expect(host.hasView(entry.view)).toBe(true);
  });

  it("disposes all groups and views", () => {
    const unregisterViewGroup = vi.fn();
    const host = new VscodeGroupHost({
      layout: { registerViewGroup: () => {}, unregisterViewGroup },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });
    host.add(groupResource(), "left");
    host.addView("g1", {
      apiVersion: VSCODE_API_VERSION,
      kind: "View",
      metadata: { id: "v1" },
      spec: { hostKind: "view-pane" },
    });

    host.dispose();

    expect(unregisterViewGroup).toHaveBeenCalledWith("g1");
    expect(host.ids()).toEqual([]);
    expect(host.viewIds()).toEqual([]);
  });

  it("adds a view to a hosted group", () => {
    const host = new VscodeGroupHost({
      layout: { registerViewGroup: () => {}, unregisterViewGroup: () => {} },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });
    host.add(groupResource(), "left");
    const view: VscodeView = {
      apiVersion: VSCODE_API_VERSION,
      kind: "View",
      metadata: { id: "v1" },
      spec: { hostKind: "view-pane", viewId: "workbench.view.explorer" },
    };

    host.addView("g1", view);

    expect(host.hasView("v1")).toBe(true);
    host.removeView("v1");
    expect(host.hasView("v1")).toBe(false);
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
      viewDefinition: viewDefinition(),
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
      ["left/container:a", "bottom/container:b"],
    );

    expect(planned.find((item) => item.resource.spec.containerId === "a")?.regionId).toBe(
      "left/container:a",
    );
    expect(planned.find((item) => item.resource.spec.containerId === "b")?.regionId).toBe(
      "bottom/container:b",
    );
  });

  it("creates one editor group per file region", () => {
    const groups = viewGroupsFromCatalogue([
      { source: "file", region: "center" },
      { source: "file", region: "center" },
      { source: "file", region: "right" },
    ]);

    expect(groups.map((group) => group.metadata.id)).toEqual([
      editorGroupId("center"),
      editorGroupId("right"),
    ]);
  });

  it("plans an editor group in its own region", () => {
    const planned = planViewGroups(
      [
        {
          view: "vscode:file:p1:a",
          appId: "a",
          title: "a",
          source: "file",
          location: "stage",
          region: "right",
        },
      ],
      ["center", "right"],
    );

    expect(planned[0]?.resource.metadata.id).toBe(editorGroupId("right"));
    expect(planned[0]?.regionId).toBe("right");
  });

  it("maps locations to default frame regions", () => {
    expect(regionForLocation("stage")).toBe("center");
    expect(regionForLocation("panel")).toBe("bottom");
    expect(regionForLocation("auxiliarybar")).toBe("right");
    expect(regionForLocation("sidebar")).toBe("left");
  });
});
