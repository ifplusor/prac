import { describe, expect, it, vi } from "vite-plus/test";
import type { ViewGroupRuntime, ViewHost, ViewRuntime } from "prac-client-ui-layout/client";
import {
  VscodeViewDefinition,
  VscodeViewGroupDefinition,
  VscodeViewHost,
  VSCODE_API_VERSION,
  type VscodeView,
  type VscodeViewGroup,
} from "./resources.js";

function groupResource(groupKind: "container" | "editor"): VscodeViewGroup {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "ViewGroup",
    metadata: { id: "g1" },
    spec: { groupKind, title: "Explorer" },
  };
}

function viewResource(): VscodeView {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "View",
    metadata: { id: "v1" },
    spec: { hostKind: "view-pane", viewId: "workbench.view.explorer" },
  };
}

function host(): ViewHost {
  return {
    mount: vi.fn(),
    release: vi.fn(),
    focus: vi.fn(),
    focusable: true,
  };
}

describe("VscodeViewGroupDefinition", () => {
  it("maps container to stack and editor to select", () => {
    const created: Array<{ id: string; mode: string }> = [];
    const definition = new VscodeViewGroupDefinition({
      createGroup: (id, mode): ViewGroupRuntime => {
        created.push({ id, mode });
        return { dispose: () => {} };
      },
    });

    definition.materialize(groupResource("container"));
    definition.materialize(groupResource("editor"));

    expect(created).toEqual([
      { id: "g1", mode: "stack" },
      { id: "g1", mode: "select" },
    ]);
  });

  it("rejects an unknown groupKind", () => {
    const definition = new VscodeViewGroupDefinition({
      createGroup: () => ({ dispose: () => {} }),
    });
    expect(() => definition.validate({ groupKind: "panel" })).toThrow(/groupKind/);
  });

  it("keeps the binding optional", () => {
    const definition = new VscodeViewGroupDefinition({
      createGroup: () => ({ dispose: () => {} }),
    });
    expect(definition.bindingFactory(groupResource("container"))).toBeUndefined();
  });

  it("passes the group id to the binding factory", () => {
    const createBinding = vi.fn(() => ({ dispose: () => {} }));
    const definition = new VscodeViewGroupDefinition({
      createGroup: () => ({ dispose: () => {} }),
      createBinding,
    });

    definition.bindingFactory(groupResource("editor"));

    expect(createBinding).toHaveBeenCalledWith({ groupKind: "editor", title: "Explorer" }, "g1");
  });
});

describe("VscodeViewDefinition", () => {
  it("materializes a view and wraps its host", () => {
    const runtime: ViewRuntime = { dispose: () => {} };
    const hostSpy = host();
    const definition = new VscodeViewDefinition({
      createView: () => runtime,
      createHost: () => hostSpy,
    });

    expect(definition.materialize(viewResource())).toBe(runtime);
    const wrapped = definition.hostFactory(viewResource());
    expect(wrapped).toBeInstanceOf(VscodeViewHost);
    expect(wrapped.focusable).toBe(true);
  });

  it("passes the move intent to the source host factory", () => {
    const createHost = vi.fn(() => host());
    const definition = new VscodeViewDefinition({
      createView: () => ({ dispose: () => {} }),
      createHost,
    });
    const intent = {
      fromViewGroupId: "g1",
      toViewGroupId: "g2",
      reason: "user" as const,
    };

    definition.hostFactory(viewResource(), { move: intent });

    expect(createHost).toHaveBeenCalledWith(expect.objectContaining({ metadata: { id: "v1" } }), {
      move: intent,
    });
  });

  it("rejects an empty hostKind", () => {
    const definition = new VscodeViewDefinition({
      createView: () => ({ dispose: () => {} }),
      createHost: () => host(),
    });
    expect(() => definition.validate({ hostKind: "" })).toThrow(/hostKind/);
  });
});
