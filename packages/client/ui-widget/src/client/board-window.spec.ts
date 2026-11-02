import { describe, expect, it } from "vite-plus/test";

import { BoardWindow, BoardWindowAdapter } from "./board-window.js";

describe("BoardWindow", () => {
  it("is one window whose content is a board", () => {
    const board = new BoardWindow("board/board");
    expect(board.id).toBe("board/board");
    expect(board.appId).toBe("prac.board");
    expect(board.content.kind).toBe("board");
  });

  it("is hosted by a generic window group", () => {
    const adapter = new BoardWindowAdapter("board", "Board");
    expect(adapter.group.primary).toBe(adapter.boardWindow);
    expect(adapter.windows).toEqual([adapter.boardWindow]);

    adapter.openWindow("editor:1");
    expect(adapter.state.order).toEqual(["board/board", "editor:1"]);
    expect(adapter.state.active).toBe("editor:1");

    adapter.closeWindow("board/board");
    expect(adapter.state.order).toEqual(["board/board", "editor:1"]);
  });
});
