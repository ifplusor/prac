/**
 * A board's layout store face.
 *
 * `BoardContent` is already a store by behaviour (`get` / `update` / `subscribe` /
 * `requestCloseView`); this gives it the frame's `LayoutStore` type so the chrome,
 * intents and resize controllers the frame uses can drive a board too. The cast is
 * at this one seam: a `WidgetRecord` is a `ViewRecord`, and the frame-side helpers
 * only read or spread the fields both share.
 *
 * @module prac-client-ui-widget/client/boardStore
 */
import type { LayoutState, LayoutStore, WidgetRecord } from "prac-client-ui-frame/lib";
import type { BoardContent } from "./boardContent.js";

/** Adapt a board content to the frame's shared store face. */
export function createBoardStore(content: BoardContent): LayoutStore {
  return {
    get: () => content.get() as unknown as LayoutState,
    subscribe: (listener) => content.subscribe(listener),
    update: (updater) =>
      content.update(
        (state) => updater(state as unknown as LayoutState) as LayoutState<WidgetRecord>,
      ),
    requestCloseView: (widgetId) => content.requestCloseView(widgetId),
  };
}
