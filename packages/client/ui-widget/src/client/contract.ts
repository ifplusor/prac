/**
 * The `pracWidgets` service's type-only contract.
 *
 * Types only: this module is the pack's `client-types` entry, published as
 * `exports["./client"].types`. It exists because the loader artifact carries a
 * banner/footer and cannot ship a declaration file, while consumers still need
 * the `Context` merge in their own program.
 *
 * @module prac-client-ui-widget/client/contract
 */

import type {} from "@deepseek-ai/cordis";

// Re-exported so the declaration artifact imports the real modules before it
// augments them; a bare `declare module` alone lets a consumer see only the
// merged members (no `ctx.effect` / `ctx.provide`).
export type { Context } from "@deepseek-ai/cordis";

import type { Side } from "prac-ui-kit-layout";

import type { BoardWindowAdapter } from "./board-window.js";
import type { WidgetRegistry } from "./widget.js";

/** The widget-board factory / registry other plugins inject. */
export interface PracWidgetsFace {
  readonly registry: WidgetRegistry;
  /** Create a board window: one window whose content is a board. */
  createBoardWindow(id: string, label?: string, instanceId?: string): BoardWindowAdapter;
  /** Board windows currently created by this service, for diagnostics / gates. */
  boards(): readonly BoardWindowAdapter[];
  /**
   * Move one widget from one board to another.
   *
   * Cross-board is **move only** (the widget keeps its source / content identity);
   * an optional split is completed inside the **target** board's root, never across
   * the two boards.
   */
  /** Show one widget (visibility, not membership). */
  show(widgetId: string): void;
  /** Hide one widget (visibility, not membership). */
  hide(widgetId: string): void;
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
