/**
 * Generic tab strip for a layout region.
 *
 * It is a chrome part: the container supplies the label / actions / close /
 * reorder behavior; the strip only renders the region's visible items in order.
 * Frame and board can use the same strip.
 *
 * @module prac-ui-kit-content/layoutTabs
 */
import { createElement } from "react";
import type { CSSProperties, DragEvent, MouseEvent, ReactElement, ReactNode } from "react";
import type { LayoutState, PlacementRecord } from "./placement.js";

const HEIGHT = 22;

const STRIP: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  height: HEIGHT,
  boxSizing: "border-box",
  flex: "0 0 auto",
  overflow: "hidden",
  background: "rgba(127,127,127,0.10)",
};

const TAB: CSSProperties = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  height: HEIGHT,
  boxSizing: "border-box",
  padding: "4px 10px",
  border: "none",
  borderRight: "1px solid rgba(127,127,127,0.22)",
  background: "transparent",
  color: "inherit",
  opacity: 0.7,
  cursor: "pointer",
  whiteSpace: "nowrap",
  maxWidth: "220px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: "0 0 auto",
};

const ACTIVE: CSSProperties = {
  opacity: 1,
  background: "rgba(127,127,127,0.22)",
  boxShadow: "inset 0 -1px 0 rgba(127,127,127,0.9)",
};

const DIRTY: CSSProperties = {
  fontSize: "9px",
  marginRight: "5px",
  verticalAlign: "middle",
  opacity: 0.9,
};

const CLOSE: CSSProperties = {
  fontSize: "11px",
  lineHeight: "1",
  marginLeft: "6px",
  padding: "0 2px",
  borderRadius: "3px",
  opacity: 0.75,
  cursor: "pointer",
};

/** Inputs for one region's tab strip. */
export interface TabStripProps<TRecord extends PlacementRecord> {
  readonly state: LayoutState<TRecord>;
  readonly regionId: string;
  readonly views: readonly string[];
  readonly active: string | undefined;
  readonly label: (itemId: string) => ReactNode;
  readonly onActivate: (itemId: string) => void;
  readonly onClose: (itemId: string) => void;
  readonly onReorder: (regionId: string, dragged: string, target: string) => void;
  readonly renderActions: (active: string | undefined) => ReactNode;
  /** Override the tab drag payload (widget drag); default is a frame tab reorder. */
  readonly onItemDragStart?: (event: DragEvent, itemId: string) => void;
}

/** Render one region's visible items as a tab strip. */
export function TabStrip<TRecord extends PlacementRecord>({
  state,
  regionId,
  views,
  active,
  label,
  onActivate,
  onClose,
  onReorder,
  renderActions,
  onItemDragStart,
}: TabStripProps<TRecord>): ReactElement {
  return createElement(
    "div",
    { key: "tabs", "data-prac-tab-strip": "", style: STRIP },
    views.map((viewId) => {
      const record = state.views[viewId];
      const dirty = record?.flags?.dirty === true;
      const preview = record?.flags?.preview === true;
      return createElement(
        "button",
        {
          key: viewId,
          type: "button",
          "data-prac-tab": viewId,
          "data-prac-tab-active": viewId === active ? "true" : "false",
          draggable: true,
          onDragStart: (event: DragEvent) => {
            if (onItemDragStart !== undefined) {
              onItemDragStart(event, viewId);
              return;
            }
            event.dataTransfer?.setData("text/prac-view", viewId);
            event.dataTransfer?.setData("text/plain", "");
            if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
          },
          onDragOver: (event: DragEvent) => event.preventDefault(),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            const dragged =
              event.dataTransfer?.getData("text/prac-view") ||
              event.dataTransfer?.getData("text/plain");
            if (dragged !== "") onReorder(regionId, dragged, viewId);
          },
          onClick: () => onActivate(viewId),
          "data-prac-tab-dirty": dirty ? "true" : "false",
          "data-prac-tab-preview": preview ? "true" : "false",
          style: {
            ...TAB,
            ...(viewId === active ? ACTIVE : {}),
            ...(preview ? { fontStyle: "italic" } : {}),
          },
        },
        ...(dirty ? [createElement("span", { key: "dirty", style: DIRTY }, "\u25cf")] : []),
        label(viewId),
        ...(record?.flags?.closable === true
          ? [
              createElement(
                "span",
                {
                  key: "close",
                  "data-prac-tab-close": viewId,
                  title: "Close",
                  style: CLOSE,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    onClose(viewId);
                  },
                },
                "\u00d7",
              ),
            ]
          : []),
      );
    }),
    createElement("span", { key: "filler", style: { flex: "1 1 auto" } }),
    createElement(
      "div",
      {
        key: "actions",
        "data-prac-tab-actions": active,
        style: { display: "flex", alignItems: "center", flex: "0 0 auto", height: "100%" },
      },
      renderActions(active),
    ),
  );
}
