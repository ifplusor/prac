import { describe, expect, it } from "vite-plus/test";
import { WindowGroupModel } from "prac-ui-kit-workbench";

import { BoardWindow, BoardWindowAdapter } from "./board-window.js";

describe("BoardWindow", () => {
  it("is one window whose content is a board", () => {
    const board = new BoardWindow("board/board");
    expect(board.id).toBe("board/board");
    expect(board.appId).toBe("prac.board");
    expect(board.content.kind).toBe("board");
  });

  it("is the primary member of the region's window group", () => {
    // The group belongs to the region; the workbench creates it and the board
    // window is its primary. The adapter itself owns no group.
    const adapter = new BoardWindowAdapter("board", "Board");
    const group = new WindowGroupModel("board", adapter.boardWindow, "Board");
    expect(group.primary).toBe(adapter.boardWindow);
    expect(group.state.order).toEqual(["board/board"]);

    group.openWindow("editor:1");
    expect(group.state.order).toEqual(["board/board", "editor:1"]);
    expect(group.state.active).toBe("editor:1");

    group.closeWindow("board/board");
    expect(group.state.order).toEqual(["board/board", "editor:1"]);
  });
});
