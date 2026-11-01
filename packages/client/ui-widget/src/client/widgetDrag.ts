/**
 * Widget drag payload and board drop-zone geometry.
 *
 * A widget drag carries its board id and widget id; the drop target turns the
 * pointer position into a side (edge = split, center = move). The MIME type is
 * separate from frame tab drags (`text/prac-view`) so a widget drag never
 * accidentally reorders a window tab.
 *
 * @module prac-client-ui-widget/client/widgetDrag
 */

/** The drag payload carried from a board widget. */
export interface WidgetDragPayload {
  readonly boardId: string;
  readonly widgetId: string;
}

/** Where a widget lands inside a board region. */
export type WidgetDropSide = "left" | "right" | "top" | "bottom" | "center";

/** Drag MIME; a widget drag is never a frame tab reorder. */
export const WIDGET_DRAG_MIME = "application/x-prac-widget";

/** Minimal drag surface shared by DOM and React drag events. */
interface WidgetDragEvent {
  readonly dataTransfer: {
    setData(type: string, value: string): void;
    getData(type: string): string;
    effectAllowed?: string;
  } | null;
}

/**
 * Start a widget drag on a native drag event.
 *
 * @param event - the source drag event.
 * @param payload - the widget's board and identity.
 */
export function startWidgetDrag(event: WidgetDragEvent, payload: WidgetDragPayload): void {
  event.dataTransfer?.setData(WIDGET_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer?.setData("text/plain", "");
  if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
  armWidgetDropCleanup();
}

/** Remove every active drop highlight. */
export function clearWidgetDropHighlights(): void {
  if (typeof document === "undefined") return;
  for (const element of document.querySelectorAll("[data-prac-widget-drop-active]")) {
    element.removeAttribute("data-prac-widget-drop-active");
    element.removeAttribute("data-prac-widget-drop-side");
  }
}

let cleanupArmed = false;

/** Arm one global cleanup for dragend / drop / Escape. */
function armWidgetDropCleanup(): void {
  if (typeof window === "undefined") return;
  if (cleanupArmed) return;
  cleanupArmed = true;
  const done = (): void => {
    cleanupArmed = false;
    clearWidgetDropHighlights();
    window.removeEventListener("dragend", done, true);
    window.removeEventListener("drop", done, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") done();
  };
  window.addEventListener("dragend", done, true);
  window.addEventListener("drop", done, true);
  window.addEventListener("keydown", onKey, true);
}

/** Read a widget drag payload from a drop event. */
export function readWidgetDrag(event: WidgetDragEvent): WidgetDragPayload | undefined {
  const raw = event.dataTransfer?.getData(WIDGET_DRAG_MIME);
  if (raw === undefined || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as WidgetDragPayload).boardId === "string" &&
      typeof (parsed as WidgetDragPayload).widgetId === "string"
    ) {
      return parsed as WidgetDragPayload;
    }
  } catch {
    // A foreign / malformed payload is not a widget drag.
  }
  return undefined;
}

/**
 * Resolve the drop side inside a rectangle.
 *
 * The outer 25% on each axis is an edge (split); the middle is a move. Corners
 * choose the dominant axis so a 200×600 sidebar does not split horizontally just
 * because the pointer is near its top edge.
 *
 * @param rect - the target region's box.
 * @param x - pointer x in viewport coordinates.
 * @param y - pointer y in viewport coordinates.
 * @param edge - edge fraction, default 0.25.
 * @returns the drop side.
 */
export function widgetDropSide(
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  x: number,
  y: number,
  edge = 0.25,
): WidgetDropSide {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const dx = (x - rect.left) / rect.width;
  const dy = (y - rect.top) / rect.height;
  const left = dx < edge;
  const right = dx > 1 - edge;
  const top = dy < edge;
  const bottom = dy > 1 - edge;
  if (!left && !right && !top && !bottom) return "center";
  // Dominant axis: compare the distance past the edge fraction.
  const horizontal = Math.max(left ? edge - dx : 0, right ? dx - (1 - edge) : 0);
  const vertical = Math.max(top ? edge - dy : 0, bottom ? dy - (1 - edge) : 0);
  if (horizontal >= vertical) return left ? "left" : "right";
  return top ? "top" : "bottom";
}
