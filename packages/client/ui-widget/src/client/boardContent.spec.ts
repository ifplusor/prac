import { describe, expect, it } from "vite-plus/test";
import { BoardContent } from "./boardContent.js";
import { structuralRegion } from "prac-ui-kit-frame";

describe("BoardContent place", () => {
  it("moves an existing widget to another region id", () => {
    const board = new BoardContent("b");
    board.placeWidget("a");
    board.placeWidget("b");
    const target = board.get().views["a"]?.region;
    const source = board.get().views["b"]?.region;
    expect(source).toBeDefined();
    expect(structuralRegion(board.get().tree, source!)).toBe(
      structuralRegion(board.get().tree, target!),
    );
    expect(board.get().views["b"]?.order).toBe(1);
    board.moveWidgetTo("b", target!);
    expect(board.get().views["b"]?.order).toBe(0);
    expect(board.get().views["a"]?.order).toBe(1);
  });
});
