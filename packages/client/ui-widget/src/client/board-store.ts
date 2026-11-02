import type { WidgetRecord, LayoutState, LayoutStore } from "prac-ui-kit-workbench";
/**
 * A board's layout store face.
 *
 * `BoardContent` is already a store by behaviour (`get` / `update` / `subscribe` /
 * `requestCloseItem`); this gives it the frame's `LayoutStore` type so the chrome,
 * intents and resize controllers the frame uses can drive a board too. The cast is
 * at this one seam: a `WidgetRecord` is a `ItemRecord`, and the frame-side helpers
 * only read or spread the fields both share.
 *
 * @module prac-client-ui-widget/client/board-store
 */

import type { BoardContent } from "./board-content.js";

/** Adapt a board content to the frame's shared store face. */
export function createBoardStore(content: BoardContent): LayoutStore {
  return {
    get: () => content.get() as unknown as LayoutState,
    subscribe: (listener) => content.subscribe(listener),
    update: (updater) =>
      content.update(
        (state) => updater(state as unknown as LayoutState) as LayoutState<WidgetRecord>,
      ),
    requestCloseItem: (widgetId) => content.requestCloseItem(widgetId),
  };
}
