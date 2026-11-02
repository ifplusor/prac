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
    createView: (id) => ({ id }),
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
    const registerWindowGroup = vi.fn();
    const unregisterWindowGroup = vi.fn();
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup, unregisterWindowGroup },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });

    const group = host.add(groupResource(), "left");

    expect(group.id).toBe("g1");
    expect(registerWindowGroup).toHaveBeenCalledWith(group, "left");
    expect(group.binding).toBeDefined();

    host.remove("g1");
    expect(unregisterWindowGroup).toHaveBeenCalledWith("g1");
  });

  it("reconciles groups and views from a catalogue", () => {
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup: () => {} },
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
    // A container is a board window; this host plans no window group for it.
    expect(host.ids()).toEqual([]);
    expect(host.hasView(entry.view)).toBe(false);
  });

  it("writes a frame reorder into the editor model", () => {
    const onReorder = vi.fn();
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup: () => {} },
      definition: definition(),
      viewDefinition: viewDefinition(),
      filePlacement: (viewId) =>
        viewId.startsWith("vscode:file:")
          ? { placement: viewId.split(":")[2] ?? "", resource: "file:///a" }
          : undefined,
      onReorder,
    });
    host.add(groupResource(), "left");
    const view = (id: string): VscodeView => ({
      apiVersion: VSCODE_API_VERSION,
      kind: "View",
      metadata: { id },
      spec: { hostKind: "editor-pane" },
    });
    host.addView("g1", view("vscode:file:p1:file:///a"));
    host.addView("g1", view("vscode:file:p2:file:///b"));

    host.reorder("g1", ["vscode:file:p2:file:///b", "vscode:file:p1:file:///a"]);

    expect(onReorder).toHaveBeenCalledWith("g1", [
      { placement: "p2", resource: "file:///a" },
      { placement: "p1", resource: "file:///a" },
    ]);
  });

  it("leaves container placement to the workbench", () => {
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup: () => {} },
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
    expect(host.hasView(entry.view)).toBe(false);
    host.sync([{ ...entry, containerId: "other" }], regions);
    expect(host.hasView(entry.view)).toBe(false);
  });

  it("never hosts a container group", () => {
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup: () => {} },
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
    expect(host.has("vscode:group:workbench.view.explorer")).toBe(false);
    host.sync([], regions);
    host.sync([entry], regions);
    expect(host.has("vscode:group:workbench.view.explorer")).toBe(false);
  });

  it("disposes all groups and views", () => {
    const unregisterWindowGroup = vi.fn();
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup },
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

    expect(unregisterWindowGroup).toHaveBeenCalledWith("g1");
    expect(host.ids()).toEqual([]);
    expect(host.viewIds()).toEqual([]);
  });

  it("adds a view to a hosted group", () => {
    const host = new VscodeGroupHost({
      layout: { registerWindowGroup: () => {}, unregisterWindowGroup: () => {} },
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
        registerWindowGroup: () => {
          throw new Error("no region");
        },
        unregisterWindowGroup: () => {},
      },
      definition: definition(),
      viewDefinition: viewDefinition(),
    });

    expect(() => host.add(groupResource(), "missing")).toThrow(/no region/);
  });
});

describe("viewGroupsFromCatalogue", () => {
  it("plans no window group for a container", () => {
    const groups = viewGroupsFromCatalogue([
      { containerId: "a", containerTitle: "A" },
      { containerId: "a", containerTitle: "A" },
      { containerId: "b" },
      {},
    ]);

    expect(groups).toEqual([]);
  });

  it("plans a container nowhere (a board window owns it)", () => {
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

    expect(planned).toEqual([]);
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
