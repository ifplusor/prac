/**
 * Dragging a stack entry by its title: reorder, not resize.
 *
 * A stack row's title answers to both a click and a drag: a click folds the entry
 * (`setViewFolded`), a drag moves it among its siblings
 * (`moveItemInRegion` / `moveEntry`). This module owns that machine — the slop,
 * the drop line, the "row under the pointer" hit test — so the frame and a board
 * root share one implementation over their own store.
 *
 * @module prac-ui-kit-content/layout-stack-drag
 */
import { findRegion } from "prac-ui-kit-layout";
import type { PlacementRecord } from "./placement.js";
import type { LayoutStore } from "./store.js";
import { readStackRows, type StackContainer } from "./resize-controller.js";
import { moveEntry, moveItemInRegion, setEntryFolded, setItemCollapsed } from "./model.js";

/**
 * How far a press may drift before it counts as a drag instead of a click.
 *
 * A title bar answers to both: a click folds the entry (`setItemCollapsed`), a drag reorders it
 * (`moveItemInRegion`). This slop is what drag-and-drop layers use to tell the two apart.
 */
export const REORDER_SLOP = 4;

/** The pointer fields a reorder needs (a DOM `PointerEvent` qualifies). */
export interface StackReorderPointer {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: { readonly parentElement: unknown };
  preventDefault(): void;
}

/** One in-flight reorder drag. */
let reorderDrag: {
  itemId: string;
  pointerId: number;
  container: HTMLElement;
  line: HTMLElement;
  origin: { x: number; y: number };
  moved: boolean;
  target: { reference: string; direction: "up" | "down" } | null;
} | null = null;

/**
 * Start a reorder: the pointer went down on an entry's **title** (not its bottom `SASH_SIZE`
 * px, which is the resizing sash, and not the fold switch). Upstream states a move as reference
 * + direction (`Grid.moveView`, `grid.ts:480-495`), so the drop target is "the row under the
 * pointer, above or below its midline"; a pointer that leaves the rows drops nothing and the
 * entry stays where it was. The dragged entry keeps its height and fold state — only `order`
 * changes — and this path never folds anything (`setItemCollapsed` is not involved).
 *
 * @param store - the container's layout store.
 * @param down - the pointer-down event on the entry's title.
 * @param itemId - the entry being dragged.
 * @param containerIn - the stack container; defaults to the title's parent element.
 */
export function beginStackReorder<TRecord extends PlacementRecord>(
  store: LayoutStore<TRecord>,
  down: StackReorderPointer,
  itemId: string,
  containerIn?: HTMLElement | null,
): void {
  const container = containerIn ?? (down.currentTarget.parentElement as HTMLElement | null);
  if (container === null || container === undefined) return;
  const line = document.createElement("div");
  line.setAttribute("data-prac-stack-drop", itemId);
  Object.assign(line.style, {
    position: "absolute",
    left: "0",
    right: "0",
    height: "2px",
    background: "var(--vscode-focusBorder, #007fd4)",
    pointerEvents: "none",
    zIndex: "6",
  });
  const drag = {
    itemId,
    pointerId: down.pointerId,
    container,
    line,
    origin: { x: down.clientX, y: down.clientY },
    moved: false,
    target: null as { reference: string; direction: "up" | "down" } | null,
  };
  reorderDrag = drag;
  const rows = (): { id: string; element: HTMLElement; top: number; bottom: number }[] =>
    [...container.querySelectorAll<HTMLElement>("[data-prac-stack-entry]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id:
          element.getAttribute("data-prac-stack-row") ??
          element.getAttribute("data-prac-stack-entry") ??
          "",
        element,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  const stop = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", drop);
    drag.line.remove();
    if (reorderDrag === drag) reorderDrag = null;
  };
  const drop = (): void => {
    if (reorderDrag !== drag) return;
    stop();
  };
  const move = (moveEvent: PointerEvent): void => {
    if (reorderDrag !== drag || moveEvent.pointerId !== drag.pointerId) return;
    // A press that stays put is a **click** (fold/unfold); only real movement reorders.
    if (
      Math.abs(moveEvent.clientX - drag.origin.x) > REORDER_SLOP ||
      Math.abs(moveEvent.clientY - drag.origin.y) > REORDER_SLOP
    ) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    const hit = rows().find(
      (row) => moveEvent.clientY >= row.top && moveEvent.clientY < row.bottom,
    );
    if (hit === undefined || hit.id === "") {
      // Off the rows: nothing will be dropped, so show nothing.
      drag.target = null;
      drag.line.remove();
      return;
    }
    const direction = moveEvent.clientY < hit.top + (hit.bottom - hit.top) / 2 ? "up" : "down";
    drag.target = { reference: hit.id, direction };
    hit.element.appendChild(drag.line);
    drag.line.style.top = direction === "up" ? "0" : "";
    drag.line.style.bottom = direction === "down" ? "0" : "";
  };
  const finish = (upEvent: PointerEvent): void => {
    if (reorderDrag !== drag || upEvent.pointerId !== drag.pointerId) return;
    const target = drag.target;
    const moved = drag.moved;
    stop();
    if (!moved) {
      // They clicked the title rather than dragging it: that is the fold switch.
      const height = readStackRows(container as unknown as StackContainer).find(
        (row) => row.itemId === itemId,
      )?.height;
      store.update((state) =>
        findRegion(state.tree, itemId)?.entry === true
          ? setEntryFolded(
              state,
              itemId,
              findRegion(state.tree, itemId)?.collapsed !== true,
              height,
            )
          : setItemCollapsed(state, itemId, state.items[itemId]?.collapsed !== true, height),
      );
      return;
    }
    if (target === null || target.reference === itemId) return;
    store.update((state) =>
      findRegion(state.tree, itemId)?.entry === true
        ? moveEntry(state, itemId, target.reference, target.direction)
        : moveItemInRegion(state, itemId, target.reference, target.direction),
    );
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", drop);
  down.preventDefault();
}
