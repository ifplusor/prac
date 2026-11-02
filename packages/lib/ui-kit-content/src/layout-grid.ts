/**
 * Grid chrome: the handles a grid node offers its container.
 *
 * A grid's geometry is the layout engine's; these are the browser controls
 * around it — move / merge / unmerge / resize per cell, drag per track. They are
 * chrome, so they live outside the renderer and are contributed at the
 * `grid.cell` / `grid.track` anchors. The frame and a board root use the same
 * components over their own store.
 *
 * @module prac-ui-kit-content/layout-grid
 */
import { createElement, Fragment } from "react";
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { GridNode, GridPlacement } from "prac-ui-kit-layout";
import {
  gridTrackWeights,
  mergeGridCells,
  resizeGridCell,
  resizeGridTrack,
  unmergeGridCell,
} from "prac-ui-kit-layout";
import type { LayoutStore } from "./store.js";

const HANDLE_BUTTON = {
  position: "absolute",
  zIndex: 2,
  padding: 0,
  border: "1px solid rgba(127,127,127,0.55)",
  borderRadius: 2,
  background: "rgba(127,127,127,0.25)",
  color: "inherit",
  opacity: 0.45,
} as const;

/** Inputs for one cell's handles. */
export interface GridCellHandlesProps {
  readonly store: LayoutStore;
  readonly grid: GridNode;
  readonly child: GridNode["children"][number];
  readonly placement: GridPlacement;
  readonly shape: { readonly rows: number; readonly columns: number };
  readonly cellCount: number;
}

/**
 * The controls inside one grid cell: drag to move, merge with a neighbour,
 * unmerge a merged cell, drag the corner to resize the span.
 */
export function GridCellHandles({
  store,
  grid,
  child,
  placement,
  shape,
  cellCount,
}: GridCellHandlesProps): ReactNode {
  if (cellCount <= 1) return null;
  const rowSpan = placement.rowSpan ?? 1;
  const columnSpan = placement.columnSpan ?? 1;
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        key: "move",
        type: "button",
        draggable: true,
        "data-prac-grid-handle": child.id,
        title: "Drag to move this grid cell; Shift-drag to merge",
        onDragStart: (event: ReactDragEvent<HTMLElement>) => {
          event.dataTransfer?.setData("text/prac-grid-cell", child.id);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
        },
        style: {
          ...HANDLE_BUTTON,
          top: 2,
          left: 2,
          width: 12,
          height: 12,
          cursor: "grab",
        },
        "aria-label": "Move grid cell",
      },
      "⠿",
    ),
    createElement(
      "button",
      {
        key: "merge",
        type: "button",
        "data-prac-grid-merge": child.id,
        title: "Merge this grid cell with the next one",
        onClick: () =>
          store.update((current) => {
            const other = grid.children.find((candidate) => candidate.id !== child.id);
            if (other === undefined) return current;
            const tree = mergeGridCells(current.tree, grid.id, child.id, other.id);
            return tree === current.tree ? current : { ...current, tree };
          }),
        style: {
          ...HANDLE_BUTTON,
          left: 2,
          bottom: 2,
          width: 18,
          height: 18,
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
          opacity: 0.7,
        },
        "aria-label": `Merge grid cell ${child.id} with its neighbour`,
      },
      "⊞",
    ),
    child.type === "split" && child.id.startsWith("merge:")
      ? createElement(
          "button",
          {
            key: "unmerge",
            type: "button",
            "data-prac-grid-unmerge": child.id,
            title: "Split this merged grid cell",
            onClick: () =>
              store.update((current) => {
                const tree = unmergeGridCell(current.tree, grid.id, child.id);
                return tree === current.tree ? current : { ...current, tree };
              }),
            style: {
              ...HANDLE_BUTTON,
              left: 2,
              bottom: 2,
              width: 18,
              height: 18,
              fontSize: 11,
              lineHeight: 1,
              cursor: "pointer",
              opacity: 0.7,
            },
            "aria-label": `Unmerge grid cell ${child.id}`,
          },
          "⧉",
        )
      : null,
    createElement(
      "button",
      {
        key: "resize",
        type: "button",
        "data-prac-grid-resize": child.id,
        title: "Drag to resize this grid cell",
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.button !== 0) return;
          const gridElement = (event.currentTarget as HTMLElement).closest("[data-prac-grid]");
          const rect = gridElement?.getBoundingClientRect();
          if (rect === undefined || rect.width <= 0 || rect.height <= 0) return;
          const startX = event.clientX;
          const startY = event.clientY;
          const move = (pointer: PointerEvent): void => {
            const rows = Math.max(
              1,
              rowSpan +
                Math.round(
                  (pointer.clientY - startY) / Math.max(1, rect.height / Math.max(1, shape.rows)),
                ),
            );
            const columns = Math.max(
              1,
              columnSpan +
                Math.round(
                  (pointer.clientX - startX) / Math.max(1, rect.width / Math.max(1, shape.columns)),
                ),
            );
            store.update((current) => {
              const tree = resizeGridCell(current.tree, grid.id, child.id, rows, columns);
              return tree === current.tree ? current : { ...current, tree };
            });
          };
          const finish = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", finish, { once: true });
          event.preventDefault();
          event.stopPropagation();
        },
        style: {
          ...HANDLE_BUTTON,
          right: 2,
          bottom: 2,
          width: 12,
          height: 12,
          cursor: "nwse-resize",
        },
        "aria-label": "Resize grid cell",
      },
      "⤢",
    ),
  );
}

/** Inputs for one grid track's handle. */
export interface GridTrackHandleProps {
  readonly store: LayoutStore;
  readonly grid: GridNode;
  readonly axis: "column" | "row";
  readonly index: number;
  readonly shape: { readonly rows: number; readonly columns: number };
}

/** The draggable boundary between two grid tracks. */
export function GridTrackHandle({
  store,
  grid,
  axis,
  index,
  shape,
}: GridTrackHandleProps): ReactNode {
  const count = axis === "column" ? shape.columns : shape.rows;
  const weights = gridTrackWeights(grid, axis, count);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const offset = (weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / total) * 100;
  const start = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const gridElement = (event.currentTarget as HTMLElement).closest("[data-prac-grid]");
    const rect = gridElement?.getBoundingClientRect();
    if (rect === undefined) return;
    const extent = axis === "column" ? rect.width : rect.height;
    if (extent <= 0) return;
    let last = axis === "column" ? event.clientX : event.clientY;
    const move = (pointer: PointerEvent): void => {
      const delta = (axis === "column" ? pointer.clientX : pointer.clientY) - last;
      last = axis === "column" ? pointer.clientX : pointer.clientY;
      store.update((current) => {
        const tree = resizeGridTrack(current.tree, grid.id, axis, index, delta, extent);
        return tree === current.tree ? current : { ...current, tree };
      });
    };
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    event.preventDefault();
    event.stopPropagation();
  };
  return createElement("div", {
    key: `track:${axis}:${index}`,
    "data-prac-grid-track": `${axis}:${index + 1}`,
    title: axis === "column" ? "Drag to resize grid columns" : "Drag to resize grid rows",
    onPointerDown: start,
    style:
      axis === "column"
        ? {
            position: "absolute",
            left: `${offset}%`,
            top: 0,
            bottom: 0,
            width: 5,
            transform: "translateX(-50%)",
            zIndex: 3,
            cursor: "col-resize",
            background: "transparent",
          }
        : {
            position: "absolute",
            top: `${offset}%`,
            left: 0,
            right: 0,
            height: 5,
            transform: "translateY(-50%)",
            zIndex: 3,
            cursor: "row-resize",
            background: "transparent",
          },
  });
}
