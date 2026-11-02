import type { Side } from "prac-ui-kit-layout";
/**
 * Widget service provided to adapter plugins.
 *
 * @module prac-client-ui-widget/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only, for the frame plugin's `Context` / `SlotMap` merges.
import type {} from "prac-client-ui-frame/client";

import type { BoardWindowFrameFace } from "./boardWindow.js";
import { BoardWindowAdapter } from "./boardWindow.js";
import { WidgetRegistry } from "./widget.js";

/** The widget-board factory / registry other plugins inject. */
export interface PracWidgetsFace {
  readonly registry: WidgetRegistry;
  /** Create a board window: one window whose content is a board. */
  createBoardWindow(id: string, label?: string): BoardWindowAdapter;
  /** Board windows currently created by this service, for diagnostics / gates. */
  boards(): readonly BoardWindowAdapter[];
  /**
   * Move one widget from one board to another.
   *
   * Cross-board is **move only** (the widget keeps its source / content identity);
   * an optional split is completed inside the **target** board's root, never across
   * the two boards.
   */
  moveWidget(
    widgetId: string,
    fromBoardId: string,
    toBoardId: string,
    options?: { readonly split?: Side },
  ): boolean;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracWidgets: PracWidgetsFace;
  }
}

/** Install the widget service. */
export function apply(ctx: Context): void {
  const boards = new Map<string, BoardWindowAdapter>();
  const frame = ctx.pracFrame;
  /** The frame facts a board window registers through. */
  const windowFace: BoardWindowFrameFace = {
    registerBoardLayout: (boardId, content, chrome) =>
      frame.registerBoardLayout(
        boardId,
        { getState: () => content.get(), subscribe: (listener) => content.subscribe(listener) },
        // The dts bundler inlines ChromeRegistry through two module records; the
        // runtime value is the same registry the frame already consumes.
        chrome as unknown as Parameters<typeof frame.registerBoardLayout>[2],
      ),
    setItemBoard: (viewId, boardId) => frame.setItemBoard(viewId, boardId),
  };
  const face: PracWidgetsFace = {
    registry: new WidgetRegistry(),
    createBoardWindow: (id, label) => {
      const existing = boards.get(id);
      if (existing !== undefined) return existing;
      const board = new BoardWindowAdapter(id, label, windowFace);
      boards.set(id, board);
      return board;
    },
    boards: () => [...boards.values()].filter((board) => !board.disposed),
    moveWidget: (widgetId, fromBoardId, toBoardId, options = {}) => {
      const find = (id: string): BoardWindowAdapter | undefined =>
        boards.get(id) ?? [...boards.values()].find((board) => board.boardId === id);
      const from = find(fromBoardId);
      const to = find(toBoardId);
      if (from === undefined || to === undefined || from === to) return false;
      if (!from.hasWidget(widgetId)) return false;
      from.removeWidget(widgetId);
      to.addWidget(widgetId);
      if (options.split !== undefined) to.splitWidget(widgetId, options.split);
      return true;
    },
  };
  ctx.provide("pracWidgets", face);
  globalThis.__pracWidgets = face;
  ctx.effect(() => () => {
    if (globalThis.__pracWidgets === face) delete globalThis.__pracWidgets;
  });
}

/** Cordis plugin name. */
export const name = "prac-client-ui-widget";
/** The widget plugin needs the frame's placement face. */
export const inject = ["pracFrame", "pracSurfaces"];

declare global {
  var __pracWidgets: PracWidgetsFace | undefined;
}
