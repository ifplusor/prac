import { describe, expect, it, vi } from "vite-plus/test";
import type { FrameView, ViewHost } from "prac-client-ui-layout/client";
import {
  VscodeViewDefinition,
  VscodeViewGroupDefinition,
  VscodeViewHost,
  createVscodeViewHost,
  VSCODE_API_VERSION,
  type VscodeGroupRuntime,
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
    add: () => {},
    remove: () => {},
    select: () => {},
    reorder: () => {},
    dispose: vi.fn(),
  };
}

function fakeView(id: string): FrameView {
  return {
    id,
    host: undefined,
    mount: () => {},
    release: () => {},
    focus: () => {},
    dispose: () => {},
  };
}

describe("VscodeViewGroupDefinition", () => {
  it("maps container to stack and editor to select", () => {
    const created: Array<{ id: string; mode: string }> = [];
    const definition = new VscodeViewGroupDefinition({
      createGroup: (id, mode): VscodeGroupRuntime => {
        created.push({ id, mode });
        return fakeGroup(id, mode);
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
      createGroup: (id) => fakeGroup(id),
    });
    expect(() => definition.validate({ groupKind: "panel" })).toThrow(/groupKind/);
  });

  it("keeps the binding optional", () => {
    const definition = new VscodeViewGroupDefinition({
      createGroup: (id) => fakeGroup(id),
    });
    expect(definition.bindingFactory(groupResource("container"))).toBeUndefined();
  });

  it("passes the group id to the binding factory", () => {
    const createBinding = vi.fn(() => ({ dispose: () => {} }));
    const definition = new VscodeViewGroupDefinition({
      createGroup: (id) => fakeGroup(id),
      createBinding,
    });

    definition.bindingFactory(groupResource("editor"));

    expect(createBinding).toHaveBeenCalledWith({ groupKind: "editor", title: "Explorer" }, "g1");
  });
});

describe("VscodeViewDefinition", () => {
  it("materializes a view and wraps its host", () => {
    const runtime: FrameView = fakeView("v1");
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
      createView: () => fakeView("v1"),
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

  it("builds a host that delegates to the source adapter", () => {
    const mount = vi.fn();
    const release = vi.fn();
    const focus = vi.fn();
    const wrapped = createVscodeViewHost(viewResource(), { mount, release, focus });

    const element = {} as HTMLElement;
    wrapped.mount(element);
    wrapped.focus();
    wrapped.release();

    expect(mount).toHaveBeenCalledWith("workbench.view.explorer", element);
    expect(focus).toHaveBeenCalledWith("workbench.view.explorer");
    expect(release).toHaveBeenCalledWith("workbench.view.explorer");
  });

  it("rejects an empty hostKind", () => {
    const definition = new VscodeViewDefinition({
      createView: () => fakeView("v1"),
      createHost: () => host(),
    });
    expect(() => definition.validate({ hostKind: "" })).toThrow(/hostKind/);
  });
});
