import { describe, expect, it } from "vite-plus/test";
import { regionHoldsOtherWindow } from "./editor-group.js";

const isEditorView = (viewId: string): boolean => viewId.startsWith("vscode:file:");

describe("regionHoldsOtherWindow", () => {
  it("lets the editor remove a group that only holds editor windows", () => {
    expect(
      regionHoldsOtherWindow(
        { "vscode:file:p1:file:///a.ts": { region: "region-2" } },
        "region-2",
        isEditorView,
      ),
    ).toBe(false);
  });

  it("protects a group that also holds another app's window", () => {
    expect(
      regionHoldsOtherWindow(
        {
          "vscode:file:p1:file:///a.ts": { region: "center" },
          "dsh:main:conversation": { region: "center" },
        },
        "center",
        isEditorView,
      ),
    ).toBe(true);
  });

  it("sees windows in a container's child regions", () => {
    expect(
      regionHoldsOtherWindow(
        { "dsh:main:conversation": { region: "center/dsh:main" } },
        "center",
        isEditorView,
      ),
    ).toBe(true);
  });

  it("counts a hidden window: putting it away is not closing it", () => {
    expect(
      regionHoldsOtherWindow(
        { "dsh:rightbar": { region: "center", hidden: true } },
        "center",
        isEditorView,
      ),
    ).toBe(true);
  });

  it("does not protect another region", () => {
    expect(
      regionHoldsOtherWindow(
        { "dsh:main:conversation": { region: "center" } },
        "region-2",
        isEditorView,
      ),
    ).toBe(false);
  });
});
