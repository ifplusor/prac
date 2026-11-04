import {
  boardDropSide,
  type BoardLayout,
  readBoardDrop,
  type WidgetRecord,
} from "prac-ui-kit-workbench";
import {
  ContentHostMount,
  LayoutRenderer,
  type ChromeItemFacts,
  type ContentHost,
  type LayoutDecoration,
  type LayoutRendererProps,
} from "prac-ui-kit-content";
import type { Box } from "prac-ui-kit-layout";
/**
 * One layout item's content dispatch.
 *
 * The item may be a content host, a board layout, a declared window/widget slot,
 * or a DSH slot. This module owns that decision; the frame only supplies the
 * record, the box and the slot face.
 *
 * It lives in the plugin, not in `prac-ui-kit-workbench`: the DSH slot vocabulary
 * (`dsh:sidebar`, `dsh:main:<key>`, `dsh:rightbar`) and the board-drop global
 * are the plugin's business.
 *
 * @module prac-client-ui-frame/client/layout-item
 */
import { createElement, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { WIDGET_SLOT, WINDOW_SLOT } from "./catalogue.js";
import { DSH_MAIN_PREFIX, DSH_RIGHTBAR_VIEW, DSH_SIDEBAR_VIEW, viewKind } from "./catalogue.js";

/** The slot face an item needs; frame and board can both satisfy it. */
export type ItemRenderSlot = (
  slot: string,
  props: Record<string, unknown>,
  options?: Record<string, unknown>,
) => ReactNode;

/** Inputs for one item. */
export interface LayoutItemProps {
  readonly viewId: string;
  readonly viewKind: "window" | "widget";
  readonly contentHost?: ContentHost;
  /** A board window's live layout root and chrome. */
  readonly board?: BoardLayout;
  /** The widget registry a board's drop target reports to (when its plugin is loaded). */
  readonly widgets?: () => BoardDropFace | undefined;
  /** The container's declared facts about an item (title / icon / pane header). */
  readonly itemFacts?: (itemId: string) => ChromeItemFacts;
  readonly renderSlot: ItemRenderSlot;
  /** An app window's content, when the window was opened by an app (not a slot). */
  readonly windowContent?: () => ReactNode;
  readonly box: Box;
  readonly viewportWidth: number;
}

/** Render a DSH-owned slot item. */
function renderDshView(
  viewId: string,
  renderSlot: ItemRenderSlot,
  box: Box,
  viewportWidth: number,
): ReactNode {
  if (viewId.startsWith(DSH_MAIN_PREFIX)) {
    return renderSlot("main", {}, { entryKey: viewId.slice(DSH_MAIN_PREFIX.length) });
  }
  if (viewId === DSH_SIDEBAR_VIEW) {
    return renderSlot("sidebar", { collapsed: box.width === 0, width: box.width });
  }
  if (viewId === DSH_RIGHTBAR_VIEW) {
    return renderSlot("rightbar", { width: box.width, viewportWidth, canShow: box.width > 0 });
  }
  return null;
}

/**
 * A board window's body: the board root through the generic renderer.
 *
 * Subscribed to the board's own store, so a widget change re-renders this body
 * and not the whole frame; the chrome gets the container's slot face for widget
 * actions.
 */
export interface BoardDropFace {
  boards(): readonly {
    readonly id: string;
    readonly boardId: string;
    readonly content: {
      moveWidgetTo(
        widgetId: string,
        regionId: string,
        side?: "left" | "right" | "top" | "bottom",
      ): void;
    };
  }[];
  moveWidget(
    widgetId: string,
    fromBoardId: string,
    toBoardId: string,
    options?: { readonly split?: "left" | "right" | "top" | "bottom" },
  ): boolean;
}

function boardDropDecoration(
  board: BoardLayout,
  regionId: string,
  face: BoardDropFace | undefined,
): LayoutDecoration {
  return {
    attrs: { "data-prac-widget-drop": regionId, "data-prac-board": board.boardId },
    onDragOver: (event) => {
      if (readBoardDrop(event) === undefined) return;
      event.preventDefault();
      event.currentTarget.setAttribute("data-prac-widget-drop-active", "true");
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.setAttribute(
        "data-prac-widget-drop-side",
        boardDropSide(rect, event.clientX, event.clientY),
      );
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    },
    onDragLeave: (event) => {
      event.currentTarget.removeAttribute("data-prac-widget-drop-active");
      event.currentTarget.removeAttribute("data-prac-widget-drop-side");
    },
    onDrop: (event) => {
      event.currentTarget.removeAttribute("data-prac-widget-drop-active");
      event.currentTarget.removeAttribute("data-prac-widget-drop-side");
      const payload = readBoardDrop(event);
      if (payload === undefined || face === undefined) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const side = boardDropSide(rect, event.clientX, event.clientY);
      if (payload.boardId === board.boardId) {
        const target = face.boards().find((candidate) => candidate.boardId === board.boardId);
        if (target === undefined) return;
        target.content.moveWidgetTo(
          payload.widgetId,
          regionId,
          side === "center" ? undefined : side,
        );
        return;
      }
      face.moveWidget(
        payload.widgetId,
        payload.boardId,
        board.boardId,
        side === "center" ? undefined : { split: side },
      );
    },
  };
}

function BoardItem({
  board,
  itemFacts,
  renderSlot,
  widgets,
}: {
  board: BoardLayout;
  itemFacts?: (itemId: string) => ChromeItemFacts;
  renderSlot: ItemRenderSlot;
  widgets?: () => BoardDropFace | undefined;
}): ReactNode {
  const state = useSyncExternalStore(board.subscribe, board.getState, board.getState);
  return LayoutRenderer({
    state,
    ...(board.chrome === undefined ? {} : { chrome: board.chrome }),
    slotFace: renderSlot,
    ...(itemFacts === undefined ? {} : { itemFacts }),
    decorate: (ctx) =>
      ctx.kind === "region" ? boardDropDecoration(board, ctx.regionId, widgets?.()) : undefined,
    renderItem: (_record: WidgetRecord, widgetId: string) =>
      renderSlot("prac.widget", {}, { only: widgetId }),
  } as LayoutRendererProps<WidgetRecord>);
}

/** Render one placed item. */
export function LayoutItem({
  viewId,
  viewKind: contentKind,
  contentHost,
  itemFacts,
  renderSlot,
  windowContent,
  board: boardProp,
  widgets,
  box,
  viewportWidth,
}: LayoutItemProps): ReactNode {
  if (contentHost !== undefined) {
    return createElement(ContentHostMount, { host: contentHost, contentId: viewId });
  }
  if (boardProp !== undefined) {
    return createElement(BoardItem, {
      board: boardProp,
      ...(itemFacts === undefined ? {} : { itemFacts }),
      renderSlot,
      ...(widgets === undefined ? {} : { widgets }),
    });
  }
  const kind = viewKind(viewId);
  if (kind === "declared") {
    return renderSlot(contentKind === "widget" ? WIDGET_SLOT : WINDOW_SLOT, {}, { only: viewId });
  }
  if (kind === "dsh") return renderDshView(viewId, renderSlot, box, viewportWidth);
  // An app window: content follows the app that opened it, not a slot declaration.
  if (windowContent !== undefined) return createElement(windowContent);
  return null;
}
