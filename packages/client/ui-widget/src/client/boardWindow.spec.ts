import { describe, expect, it } from "vite-plus/test";

import { BoardWindow, BoardWindowSurface } from "./boardWindow.js";

describe("BoardWindow", () => {
  it("is one window whose content is a board", () => {
    const board = new BoardWindow("board/board");
    expect(board.id).toBe("board/board");
    expect(board.appId).toBe("prac.board");
    expect(board.content.kind).toBe("board");
  });

  it("is hosted by a generic window group", () => {
    const surface = new BoardWindowSurface("board", "Board");
    expect(surface.group.primary).toBe(surface.boardWindow);
    expect(surface.windows).toEqual([surface.boardWindow]);

    surface.openWindow("editor:1");
    expect(surface.state.order).toEqual(["board/board", "editor:1"]);
    expect(surface.state.active).toBe("editor:1");

    surface.closeWindow("board/board");
    expect(surface.state.order).toEqual(["board/board", "editor:1"]);
  });
});
