import { describe, expect, it } from "vite-plus/test";

import { WidgetBoard } from "./board.js";

describe("WidgetBoard", () => {
  it("places widgets and activates the first", () => {
    const board = new WidgetBoard("b");
    board.place("folders");
    board.place("timeline");
    expect(board.state.order).toEqual(["folders", "timeline"]);
    expect(board.state.active).toBe("folders");
  });

  it("falls back to the next widget when active is removed", () => {
    const board = new WidgetBoard("b");
    board.place("a");
    board.place("b");
    board.place("c");
    board.activate("b");
    board.remove("b");
    expect(board.state.active).toBe("c");
  });

  it("rejects duplicate and unknown widgets", () => {
    const board = new WidgetBoard("b");
    board.place("a");
    expect(() => board.place("a")).toThrow(/already placed/);
    expect(() => board.activate("b")).toThrow(/unknown widget/);
  });

  it("reorders and updates placement order", () => {
    const board = new WidgetBoard("b");
    board.place("a");
    board.place("b");
    board.reorder(["b", "a"]);
    expect(board.placements.map((p) => p.order)).toEqual([0, 1]);
    expect(board.state.order).toEqual(["b", "a"]);
  });

  it("becomes empty after the last widget is removed", () => {
    const board = new WidgetBoard("b");
    board.place("a");
    board.remove("a");
    expect(board.empty).toBe(true);
    expect(board.state.active).toBeUndefined();
  });
});
