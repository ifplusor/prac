/**
 * Cross-container drop primitives.
 *
 * A drop payload is a board id + item id. The geometry is pure: the outer quarter
 * of a region is an edge (split), the middle is a move. The widget layer uses the
 * same MIME as the board source, so frame-side board items can accept it without
 * importing `ui-widget`.
 *
 * @module prac-ui-kit-frame/layoutDrop
 */
export const BOARD_DROP_MIME = "application/x-prac-widget";

/** A widget drop payload. */
export interface BoardDropPayload {
  readonly boardId: string;
  readonly widgetId: string;
}

/** Minimal drag surface shared by DOM and React drag events. */
interface DropEvent {
  readonly dataTransfer: {
    getData(type: string): string;
  } | null;
}

/** Read a widget drop payload. */
export function readBoardDrop(event: DropEvent): BoardDropPayload | undefined {
  const raw = event.dataTransfer?.getData(BOARD_DROP_MIME);
  if (raw === undefined || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as BoardDropPayload).boardId === "string" &&
      typeof (parsed as BoardDropPayload).widgetId === "string"
    ) {
      return parsed as BoardDropPayload;
    }
  } catch {
    // Not a board drop.
  }
  return undefined;
}

/** Where a drop lands inside a region. */
export type BoardDropSide = "left" | "right" | "top" | "bottom" | "center";

/**
 * Resolve a drop side from a rectangle and pointer.
 *
 * @param rect - the target region box.
 * @param x - pointer x.
 * @param y - pointer y.
 * @param edge - edge fraction, default 0.25.
 */
export function boardDropSide(
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  x: number,
  y: number,
  edge = 0.25,
): BoardDropSide {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const dx = (x - rect.left) / rect.width;
  const dy = (y - rect.top) / rect.height;
  const left = dx < edge;
  const right = dx > 1 - edge;
  const top = dy < edge;
  const bottom = dy > 1 - edge;
  if (!left && !right && !top && !bottom) return "center";
  const horizontal = Math.max(left ? edge - dx : 0, right ? dx - (1 - edge) : 0);
  const vertical = Math.max(top ? edge - dy : 0, bottom ? dy - (1 - edge) : 0);
  if (horizontal >= vertical) return left ? "left" : "right";
  return top ? "top" : "bottom";
}
