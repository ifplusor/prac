import { describe, expect, it, vi } from "vite-plus/test";
import type { FrameView } from "prac-client-ui-frame/client";

import { WidgetBoardGroup } from "./boardGroup.js";

function view(id: string): FrameView {
  return {
    id,
    host: undefined,
    mount: vi.fn(),
    release: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("WidgetBoardGroup", () => {
  it("adds a frame view as a board placement", () => {
    const group = new WidgetBoardGroup("b");
    const a = view("a");
    group.add(a);
    expect(group.state.order).toEqual(["a"]);
    expect(group.placements[0]?.viewId).toBe("a");
  });

  it("activates a board placement through select", () => {
    const group = new WidgetBoardGroup("b");
    group.add(view("a"));
    group.add(view("b"));
    group.select("b");
    expect(group.state.active).toBe("b");
  });

  it("releases the frame view on remove", () => {
    const group = new WidgetBoardGroup("b");
    const a = view("a");
    group.add(a);
    group.remove("a");
    expect(a.release).toHaveBeenCalled();
    expect(group.state.order).toEqual([]);
  });

  it("reorders board placements", () => {
    const group = new WidgetBoardGroup("b");
    group.add(view("a"));
    group.add(view("b"));
    group.reorder(["b", "a"]);
    expect(group.state.order).toEqual(["b", "a"]);
    expect(group.placements.map((p) => p.order)).toEqual([0, 1]);
  });
});
