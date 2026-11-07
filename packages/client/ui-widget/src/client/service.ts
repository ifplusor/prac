/**
 * Widget service provided to adapter plugins.
 *
 * @module prac-client-ui-widget/client/service
 */

import { publishProbe } from "prac-ui-kit-workbench/probes";
import type { Context } from "@deepseek-ai/cordis";
// Type-only, for the frame plugin's `Context` / `SlotMap` merges.
import type {} from "prac-client-ui-frame/client";

import type { PracAppDef, PracExtension, PracExtensionsFace } from "prac-client-ui-frame/client";
import type { BoardWindowFrameFace } from "./board-window.js";
import { BoardWindowAdapter } from "./board-window.js";
import { WidgetRegistry } from "./widget.js";
import type { PracWidgetsFace } from "./contract.js";

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
  // The board is an app window: the region's window group holds it like any other
  // window. It is a core extension contribution, not a direct registry write.
  const boardApp: PracAppDef = {
    id: "prac.board",
    version: "1",
    label: "Board",
    instances: "multi",
  };
  const coreExtension: PracExtension = {
    manifest: { id: "prac.core.board", origin: "prac", version: "1" },
    apps: () => [boardApp],
  };
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  ctx.effect(() => extensions.register(coreExtension), "prac-client-ui-widget: board app");
  const face: PracWidgetsFace = {
    registry: new WidgetRegistry(),
    createBoardWindow: (id, label) => {
      const existing = boards.get(id);
      if (existing !== undefined) return existing;
      const board = new BoardWindowAdapter(id, label, windowFace);
      boards.set(id, board);
      ctx.pracWindows.admit("prac.board", { windowId: board.boardId, title: label ?? "Board" });
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
  // The page-level probe: gates read the same face through one registry. The
  // frame reads it from the Cordis service (its board drop decoration), not from
  // this global.
  ctx.effect(() => publishProbe("widgets", face));
}

/** Cordis plugin name. */
export const name = "prac-client-ui-widget";
/** The widget plugin needs the frame's placement face. */
export const inject = [
  "pracFrame",
  "pracSurfaces",
  "pracExtensions",
  "pracApplications",
  "pracWindows",
];
