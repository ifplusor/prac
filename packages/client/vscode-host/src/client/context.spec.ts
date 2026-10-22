import { describe, expect, it } from "vite-plus/test";
import { resolveContainerContext } from "./context.js";
import { VscodeGroupBinding, VSCODE_API_VERSION, type VscodeView } from "./resources.js";

function view(containerId?: string): VscodeView {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "View",
    metadata: { id: "v1" },
    spec: {
      hostKind: "view-pane",
      ...(containerId === undefined ? {} : { containerId }),
    },
  };
}

describe("resolveContainerContext", () => {
  it("uses the group's container when the group is bound", () => {
    const binding = new VscodeGroupBinding("g1", "container", {
      containerId: "workbench.view.explorer",
    });

    expect(resolveContainerContext(view("source.container"), binding)).toEqual({
      sourceContainerId: "source.container",
      effectiveContainerId: "workbench.view.explorer",
      mode: "group",
    });
  });

  it("suppresses the source container in a plain group", () => {
    expect(resolveContainerContext(view("source.container"))).toEqual({
      sourceContainerId: "source.container",
      mode: "unbound",
    });
  });

  it("reports unbound when neither side has a container", () => {
    expect(resolveContainerContext(view())).toEqual({ mode: "unbound" });
  });
});
