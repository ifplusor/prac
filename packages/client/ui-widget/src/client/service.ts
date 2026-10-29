/**
 * Widget service provided to adapter plugins.
 *
 * @module prac-client-ui-widget/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SurfaceRegistry, ViewGroup } from "prac-ui-kit";
import { WidgetBoardGroup } from "./boardGroup.js";
import { WidgetRegistry } from "./widget.js";

/** The widget-board factory / registry other plugins inject. */
export interface PracWidgetsFace {
  readonly registry: WidgetRegistry;
  createBoardGroup(id: string, label?: string): WidgetBoardGroup;
  /** Boards currently created by this service, for diagnostics / gates. */
  boards(): readonly WidgetBoardGroup[];
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracWidgets: PracWidgetsFace;
  }
}

/** Install the widget service. */
export function apply(ctx: Context): void {
  const surfaces = ctx as unknown as { pracSurfaces: SurfaceRegistry<ViewGroup> };
  const boards = new Set<WidgetBoardGroup>();
  const face: PracWidgetsFace = {
    registry: new WidgetRegistry(),
    createBoardGroup: (id, label) => {
      const board = new WidgetBoardGroup(id, label);
      boards.add(board);
      return board;
    },
    boards: () => [...boards],
  };
  ctx.provide("pracWidgets", face);
  globalThis.__pracWidgets = face;
  ctx.effect(() => () => {
    if (globalThis.__pracWidgets === face) delete globalThis.__pracWidgets;
  });
  ctx.effect(() => {
    const registration = surfaces.pracSurfaces.register("widget-board", {
      create: ({ nodeId }) => new WidgetBoardGroup(nodeId),
    });
    return () => registration.dispose();
  });
}

/** Cordis plugin name. */
export const name = "prac-client-ui-widget";
/** The widget plugin needs the frame's placement face. */
export const inject = ["pracFrame", "pracSurfaces"];

declare global {
  var __pracWidgets: PracWidgetsFace | undefined;
}
