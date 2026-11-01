/**
 * A board window's content renderer.
 *
 * This is the bridge from a `BoardContent` (its own `LayoutState<WidgetRecord>`)
 * to the generic `LayoutRenderer`. It renders the board root only; frame chrome
 * (window group tab strip, sashes) stays outside.
 *
 * @module prac-client-ui-widget/client/boardWindow
 */
import { useMemo, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { ChromeRegistry, WidgetRecord } from "prac-client-ui-frame/lib";
import { LayoutRenderer, type LayoutRendererProps } from "prac-client-ui-frame/lib";
import type { BoardContent } from "./boardContent.js";
import { createBoardChrome } from "./boardChrome.js";

/** Inputs for one board window's content. */
export interface BoardWindowProps {
  readonly content: BoardContent;
  /** Render one widget's content by its id. */
  readonly renderWidget: (widgetId: string) => ReactNode;
  /** Board chrome (header / tabs / footer / actions). */
  readonly chrome?: ChromeRegistry<WidgetRecord>;
}

/** Render a board window's content from its own layout root. */
export function BoardWindow({ content, renderWidget, chrome }: BoardWindowProps): ReactElement {
  const state = useSyncExternalStore(
    (listener) => content.subscribe(listener),
    () => content.get(),
    () => content.get(),
  );
  const boardChrome = useMemo(() => chrome ?? createBoardChrome(content), [chrome, content]);
  const props: LayoutRendererProps<WidgetRecord> = {
    state,
    ...(boardChrome === undefined ? {} : { chrome: boardChrome }),
    renderItem: (_record, widgetId) => renderWidget(widgetId),
  };
  return LayoutRenderer(props);
}
