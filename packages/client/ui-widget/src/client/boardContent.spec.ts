import { structuralRegion } from "prac-ui-kit-content";
import { describe, expect, it } from "vite-plus/test";
import { BoardContent } from "./boardContent.js";

describe("BoardContent place", () => {
  it("moves an existing widget to another region id", () => {
    const board = new BoardContent("b");
    board.placeWidget("a");
    board.placeWidget("b");
    const target = board.get().items["a"]?.region;
    const source = board.get().items["b"]?.region;
    expect(source).toBeDefined();
    expect(structuralRegion(board.get().tree, source!)).toBe(
      structuralRegion(board.get().tree, target!),
    );
    expect(board.get().items["b"]?.order).toBe(1);
    board.moveWidgetTo("b", target!);
    expect(board.get().items["b"]?.order).toBe(0);
    expect(board.get().items["a"]?.order).toBe(1);
  });
});
