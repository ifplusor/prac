import { describe, expect, it } from "vite-plus/test";
import {
  WIDGET_DRAG_MIME,
  readWidgetDrag,
  startWidgetDrag,
  widgetDropSide,
} from "./widget-drag.js";

function dragEvent(data: Map<string, string> = new Map()): DragEvent {
  return {
    dataTransfer: {
      getData: (type: string) => data.get(type) ?? "",
      setData: (type: string, value: string) => data.set(type, value),
      effectAllowed: "all",
    },
  } as unknown as DragEvent;
}

describe("widget drag", () => {
  it("round-trips a widget payload under its own MIME", () => {
    const data = new Map<string, string>();
    startWidgetDrag(dragEvent(data), { boardId: "left", widgetId: "timeline" });
    expect(data.get(WIDGET_DRAG_MIME)).toBe(
      JSON.stringify({ boardId: "left", widgetId: "timeline" }),
    );
    expect(readWidgetDrag(dragEvent(data))).toEqual({
      boardId: "left",
      widgetId: "timeline",
    });
  });

  it("ignores malformed and foreign payloads", () => {
    const bad = new Map([[WIDGET_DRAG_MIME, "{"]]);
    expect(readWidgetDrag(dragEvent(bad))).toBeUndefined();
    expect(readWidgetDrag(dragEvent())).toBeUndefined();
  });

  it("turns the outer quarter into an edge and the middle into move", () => {
    const rect = { left: 0, top: 0, width: 200, height: 600 };
    expect(widgetDropSide(rect, 100, 300)).toBe("center");
    expect(widgetDropSide(rect, 10, 300)).toBe("left");
    expect(widgetDropSide(rect, 190, 300)).toBe("right");
    expect(widgetDropSide(rect, 100, 10)).toBe("top");
    expect(widgetDropSide(rect, 100, 590)).toBe("bottom");
  });

  it("chooses the dominant axis at a corner", () => {
    const rect = { left: 0, top: 0, width: 200, height: 600 };
    // Both left and top; left is further past its edge fraction.
    expect(widgetDropSide(rect, 1, 100)).toBe("left");
  });
});
