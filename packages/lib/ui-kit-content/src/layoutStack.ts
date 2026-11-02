/**
 * Generic stack-row header.
 *
 * A stack row is a leaf region (`entry`) holding one item. The header renders the
 * fold switch, title and item actions; toggle/reorder behavior is supplied by the
 * container so frame and board share the same markup.
 *
 * @module prac-ui-kit-content/layoutStack
 */
import { createElement } from "react";
import type {
  CSSProperties,
  DragEvent,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { SASH_SIZE, STACK_HEADER_HEIGHT } from "./renderModel.js";

const HEADER: CSSProperties = {
  display: "block",
  height: 22,
  boxSizing: "border-box",
  width: "100%",
  textAlign: "left",
  padding: "2px 6px",
  font: "inherit",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  border: "none",
  borderTop: "1px solid rgba(128, 128, 128, 0.25)",
  background: "transparent",
  color: "inherit",
};

/** Inputs for one stack row's header. */
export interface StackHeaderProps {
  readonly nodeId: string;
  readonly viewId: string;
  readonly folded: boolean;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly onToggle: (event: MouseEvent<HTMLElement>) => void;
  readonly onReorder: (event: PointerEvent<HTMLElement>) => void;
  readonly renderActions: ReactNode;
  /** Optional native drag source for the row title (widget drag). */
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
}

/** Render a stack row's header. */
export function StackHeader({
  nodeId,
  viewId,
  folded,
  label,
  icon,
  onToggle,
  onReorder,
  renderActions,
  onDragStart,
}: StackHeaderProps): ReactElement {
  return createElement(
    "div",
    {
      "data-prac-stack-header": nodeId,
      style: { ...HEADER, display: "flex", alignItems: "center", gap: "2px" },
    },
    createElement(
      "button",
      {
        type: "button",
        "data-prac-stack-toggle": viewId,
        "aria-expanded": folded ? "false" : "true",
        title: folded ? "Expand" : "Collapse",
        onClick: onToggle,
        style: {
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: "0 2px",
          font: "inherit",
        },
      },
      folded ? "\u25b8" : "\u25be",
    ),
    icon,
    createElement(
      "span",
      {
        "data-prac-stack-title": nodeId,
        onPointerDownCapture: onReorder,
        ...(onDragStart === undefined ? {} : { draggable: true, onDragStart }),
        style: {
          flex: "1 1 auto",
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      label,
    ),
    createElement(
      "div",
      {
        "data-prac-stack-actions": nodeId,
        style: { display: "flex", alignItems: "center", flex: "0 0 auto", height: "100%" },
      },
      renderActions,
    ),
  );
}

/** Inputs for the overlay a row draws over an item's own pane header. */
export interface StackRowOverlayProps {
  readonly nodeId: string;
  readonly viewId: string;
  readonly folded: boolean;
  readonly label: ReactNode;
  readonly onToggle: (event: MouseEvent<HTMLElement>) => void;
  readonly onReorder: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * The fold switch and title-drag strip a stack row draws **over** an item that
 * brings its own pane header.
 *
 * The item owns the header, so the row keeps it and the container adds only its
 * controls on top. The strip is transparent and stops before the pane's action
 * buttons, so the one title stays the pane's.
 */
export function StackRowOverlay({
  nodeId,
  viewId,
  folded,
  label,
  onToggle,
  onReorder,
}: StackRowOverlayProps): ReactElement {
  return createElement(
    "div",
    {
      "data-prac-stack-overlay": nodeId,
      style: {
        position: "absolute",
        // Start below the sash: the boundary strip owns the row's first SASH_SIZE pixels, and
        // an overlay on top of it would swallow the boundary drag.
        top: SASH_SIZE,
        left: 0,
        right: "120px",
        height: STACK_HEADER_HEIGHT,
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        gap: "2px",
      },
    },
    createElement(
      "button",
      {
        type: "button",
        "data-prac-stack-toggle": viewId,
        "aria-expanded": folded ? "false" : "true",
        title: folded ? "Expand" : "Collapse",
        onClick: onToggle,
        style: {
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: "0 2px",
          font: "inherit",
        },
      },
      folded ? "\u25b8" : "\u25be",
    ),
    createElement(
      "span",
      {
        "data-prac-stack-title": nodeId,
        onPointerDownCapture: onReorder,
        style: {
          flex: "1 1 auto",
          height: "100%",
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      label,
    ),
  );
}
