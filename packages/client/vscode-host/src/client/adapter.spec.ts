import { describe, expect, it, vi } from "vite-plus/test";
import type { FrameView } from "prac-client-ui-layout/client";
import { createVscodeResourceDefinitions } from "./adapter.js";
import {
  VscodeGroupBinding,
  VSCODE_API_VERSION,
  type VscodeView,
  type VscodeViewGroup,
} from "./resources.js";

function groupResource(containerId: string): VscodeViewGroup {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "ViewGroup",
    metadata: { id: "g1" },
    spec: { groupKind: "container", containerId, title: "Explorer" },
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

function definitions() {
  const mountView = vi.fn();
  const releaseView = vi.fn();
  const focusView = vi.fn();
  const runAction = vi.fn();
  const face = {
    mountView,
    releaseView,
    focusView,
    containerActions: () => [{ id: "collapse", label: "Collapse", enabled: true, checked: false }],
    runAction,
  };
  const group: import("./resources.js").VscodeGroupRuntime = {
    id: "g1",
    state: { id: "g1", mode: "stack", order: [] },
    placements: [],
    onDidChange: () => () => {},
    setBinding: () => {},
    add: () => {},
    remove: () => {},
    select: () => {},
    dispose: () => {},
  };
  const view: FrameView = {
    id: "v1",
    host: undefined,
    mount: () => {},
    release: () => {},
    focus: () => {},
    dispose: () => {},
  };
  return {
    face,
    mountView,
    releaseView,
    focusView,
    runAction,
    ...createVscodeResourceDefinitions({
      face,
      createGroup: () => group,
      createView: () => view,
    }),
  };
}

describe("createVscodeResourceDefinitions", () => {
  it("wires a container binding to the face actions", () => {
    const { groups, runAction } = definitions();
    const binding = groups.bindingFactory(groupResource("workbench.view.explorer")) as
      | VscodeGroupBinding
      | undefined;
    expect(binding).toBeDefined();
    expect(binding?.actions()).toHaveLength(1);

    binding?.runAction?.("collapse");
    expect(runAction).toHaveBeenCalledWith("workbench.view.explorer", "collapse");
  });

  it("wires a view host to the face mount/release path", () => {
    const { views, mountView, releaseView, focusView } = definitions();
    const host = views.hostFactory(viewResource());
    const element = {} as HTMLElement;

    host.mount(element);
    host.focus();
    host.release();

    expect(mountView).toHaveBeenCalledWith("vscode:view:workbench.view.explorer", element);
    expect(focusView).toHaveBeenCalledWith("vscode:view:workbench.view.explorer");
    expect(releaseView).toHaveBeenCalledWith("vscode:view:workbench.view.explorer");
  });
});
