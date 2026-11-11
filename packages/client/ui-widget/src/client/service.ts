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
    manifest: { id: "prac.core.board", version: "1" },
    apps: () => [boardApp],
    // The board's content is rendered by the frame (setItemBoard); the app's
    // implementation only has to exist so the app registers.
    appRuntime: () => ({
      content: () => () => null,
      match: (resource) => resource.startsWith("left/container:"),
      start: (params: unknown, instance: { id: string }) => {
        // The board's region is the container child, not the bare container id.
        const { boardId, side } = params as { boardId: string; side: "left" | "right" };
        const region = `${side}/container:${boardId}`;
        face.createBoardWindow(region, undefined, instance.id);
        return true;
      },
    }),
  };
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  ctx.effect(() => extensions.register(coreExtension), "prac-client-ui-widget: board app");

  /** Board windows the manager has admitted (a retry must not admit twice). */
  const admitted = new Set<string>();

  /**
   * Admit one board's window into the manager.
   *
   * The region may not exist on the first catalogue pass (the arrangement
   * creates it), so a failure is swallowed and retried on the next pass — the
   * widget mount would otherwise be lost for the life of the page.
   *
   * @param board - the board whose window is admitted.
   * @param region - the container region the board lives in.
   * @param instanceId - the app instance that owns the window, when there is one.
   */
  const admitBoard = (
    board: BoardWindowAdapter,
    region: string,
    instanceId: string | undefined,
  ): void => {
    if (admitted.has(board.boardId)) return;
    try {
      ctx.pracWindows.admit("prac.board", {
        windowId: board.boardId,
        title: board.label ?? "Board",
        region,
        ...(instanceId === undefined ? {} : { instanceId }),
      });
      // The board names its region; the manager writes the placement, so the
      // projection can map the window to its pane host.
      ctx.pracWindows.place(board.boardId, region);
      admitted.add(board.boardId);
    } catch {
      // Retried by the next catalogue sync once the region exists.
    }
  };

  const face: PracWidgetsFace = {
    registry: new WidgetRegistry(),
    createBoardWindow: (id, label, instanceId) => {
      const existing = boards.get(id);
      if (existing !== undefined) {
        // The first pass may have run before the region existed; retry the
        // admission until the manager accepts it.
        admitBoard(existing, id, instanceId);
        return existing;
      }
      const board = new BoardWindowAdapter(id, label, windowFace);
      boards.set(id, board);
      admitBoard(board, id, instanceId);
      return board;
    },
    boards: () => [...boards.values()].filter((board) => !board.disposed),
    show: (widgetId) => {
      for (const board of boards.values())
        if (board.hasWidget(widgetId)) board.setWidgetHidden(widgetId, false);
    },
    hide: (widgetId) => {
      for (const board of boards.values())
        if (board.hasWidget(widgetId)) board.setWidgetHidden(widgetId, true);
    },
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
  // The extension's widgets enter the registry here: the catalog owns the
  // declarations, the registry the runtime records.
  const registered = new Map<string, () => void>();
  const syncWidgets = (): void => {
    const catalog = extensions.catalog().widgets;
    const wanted = new Set(catalog.map((widget) => widget.id));
    for (const [id, dispose] of registered) {
      if (wanted.has(id)) continue;
      dispose();
      registered.delete(id);
    }
    for (const widget of catalog) {
      if (registered.has(widget.id)) continue;
      const disposer = face.registry.register({
        id: widget.id,
        source: widget.id.includes(":") ? widget.id.slice(0, widget.id.indexOf(":")) : "prac",
        hostKind: "vscode",
        title: widget.title,
        multiplicity: "single",
        ...(widget.icon === undefined ? {} : { icon: widget.icon }),
        ...(widget.defaultBoard === undefined ? {} : { defaultBoard: widget.defaultBoard }),
        ...(widget.defaultRegion === undefined ? {} : { defaultRegion: widget.defaultRegion }),
      });
      registered.set(widget.id, () => disposer.dispose());
    }
  };
  syncWidgets();
  ctx.effect(() => extensions.onDidChange(syncWidgets), "prac-widget: catalog sync");
  // The dock shows the boards the widgets' defaultBoard implies (prac owns the board).
  const pinBoards = (): void => {
    const dock = ctx.pracDock;
    if (dock === undefined) return;
    const sides = new Map<string, "left" | "right">();
    const labels = new Map<string, string>();
    for (const definition of face.registry.list()) {
      const board = definition.defaultBoard;
      if (board === undefined) continue;
      const side = sideFor(definition.defaultRegion);
      if (side === undefined) continue;
      sides.set(board, side);
      if (!labels.has(board)) labels.set(board, definition.title);
    }
    for (const [board, side] of sides) {
      dock.pin({
        id: board,
        appId: "prac.board",
        label: labels.get(board) ?? board,
        side,
        params: { boardId: board, side },
      });
    }
  };
  pinBoards();
  ctx.effect(() => face.registry.onDidChange(pinBoards), "prac-widget: dock pins");
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
  "pracDock",
];

/**
 * The dock side for a catalogue location word.
 *
 * The app's vocabulary decides where its container lives; the panel is not a
 * rail, so it has no dock side at all.
 *
 * @param location - the catalogue's location word.
 * @returns the rail side, or undefined for a location with no rail.
 */
function sideFor(location: string | undefined): "left" | "right" | undefined {
  if (location === "sidebar") return "left";
  if (location === "auxiliarybar") return "right";
  return undefined;
}
