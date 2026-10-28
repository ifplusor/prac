/**
 * Window service provided to adapter plugins.
 *
 * @module prac-client-ui-window/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
import { WindowGroupAdapter } from "./windowGroupAdapter.js";

/** The window-group factory other plugins inject. */
export interface PracWindowsFace {
  createGroup(id: string, label?: string): WindowGroupAdapter;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracWindows: PracWindowsFace;
  }
}

/** Install the window service. */
export function apply(ctx: Context): void {
  const face: PracWindowsFace = {
    createGroup: (id, label) => new WindowGroupAdapter(id, label),
  };
  ctx.provide("pracWindows", face);
}

/** Cordis plugin name. */
export const name = "prac-client-ui-window";
/** The window plugin needs the frame's placement face. */
export const inject = ["pracFrame"];
