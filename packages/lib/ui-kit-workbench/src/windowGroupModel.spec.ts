import { describe, expect, it } from "vite-plus/test";

import type { ContentHost, Window } from "./windowModel.js";
import { WindowGroupModel } from "./windowGroupModel.js";

function window(id: string): Window {
  const content: ContentHost & { kind: string } = {
    id,
    kind: "board",
    mount: () => undefined,
    release: () => undefined,
  };
  return { id, appId: "test", content };
}

describe("WindowGroupModel", () => {
  it("owns the primary window and hosts others without owning them", () => {
    const primary = window("board/board");
    const group = new WindowGroupModel("board", primary, "Board");

    group.openWindow("editor:1");

    expect(group.state).toMatchObject({
      id: "board",
      label: "Board",
      active: "editor:1",
      order: ["board/board", "editor:1"],
    });
    expect(group.placements).toEqual([
      expect.objectContaining({ itemId: "board/board", active: false }),
      expect.objectContaining({ itemId: "editor:1", active: true, owned: false }),
    ]);
    expect(group.placements[0]?.owned).toBeUndefined();
    expect(group.windows).toEqual([primary]);
  });

  it("keeps the primary first and validates reorder", () => {
    const group = new WindowGroupModel("board", window("board/board"));
    group.openWindow("editor:1");

    group.reorder(["editor:1", "board/board"]);

    expect(group.state.order).toEqual(["board/board", "editor:1"]);
    expect(() => group.reorder(["editor:1"])).toThrow(/permutation/);

    group.closeWindow("board/board");
    expect(group.state.order).toEqual(["board/board", "editor:1"]);
  });

  it("syncs hosted windows from a placement projection", () => {
    const group = new WindowGroupModel("board", window("board/board"));
    group.syncWindows(["editor:1", "editor:2"]);
    expect(group.state.order).toEqual(["board/board", "editor:1", "editor:2"]);
    expect(group.state.active).toBe("board/board");

    group.syncWindows(["editor:2"]);
    expect(group.state.order).toEqual(["board/board", "editor:2"]);
  });
});
