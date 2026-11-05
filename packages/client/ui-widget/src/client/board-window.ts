import type { ContentHost } from "prac-ui-kit-content";
import type { Window, WidgetRecord, LayoutState } from "prac-ui-kit-workbench";
import type { Side } from "prac-ui-kit-layout";
/**
 * A board window and the surface that hosts it.
 *
 * The board is the **content of one window**, not a group of its own. `BoardWindow`
 * is the window (a `ContentItem`); `BoardWindowAdapter` is the frame surface that
 * composes it with the generic `WindowGroupModel` so editor windows can sit beside
 * it in the same group.
 *
 * @module prac-client-ui-widget/client/board-window
 */

import { BoardContent, type WidgetPlacementOptions } from "./board-content.js";
import { createBoardChrome } from "./board-chrome.js";

/** The frame facts a board window registers (the service owns the frame face). */
export interface BoardWindowFrameFace {
  registerBoardLayout(
    boardId: string,
    source: BoardContent,
    chrome: ReturnType<typeof createBoardChrome>,
  ): () => void;
  setItemBoard(itemId: string, boardId: string | undefined): void;
}

/** The content a board window renders. */
export interface BoardWindowContent extends ContentHost {
  readonly kind: "board";
  readonly activeWidget: string | undefined;
}

/** One board window: a window whose content is a board. */
export class BoardWindow implements Window {
  readonly appId = "prac.board";
  readonly content: BoardContent;

  constructor(readonly id: string) {
    this.content = new BoardContent(id);
  }
}

/**
 * A board window (its content is a board) and its widget management.
 *
 * The board is a window: the region's window group owns it as its primary member,
 * and the workbench creates that group. This adapter does not own a group.
 */
export class BoardWindowAdapter {
  readonly boardWindow: BoardWindow;
  readonly content: BoardContent;
  readonly windowId: string;
  readonly boardId: string;
  readonly label?: string;
  readonly #unregister: () => void;
  #disposed = false;

  constructor(
    readonly id: string,
    label?: string,
    frame?: BoardWindowFrameFace,
  ) {
    this.label = label;
    this.windowId = `${id}/board`;
    this.boardId = this.windowId;
    this.boardWindow = new BoardWindow(this.windowId);
    this.content = this.boardWindow.content;
    this.#unregister =
      frame?.registerBoardLayout(this.boardId, this.content, createBoardChrome(this.content)) ??
      (() => {});
  }

  addWidget(widgetId: string, options?: WidgetPlacementOptions): void {
    this.content.placeWidget(widgetId, this.boardId, options);
  }

  removeWidget(widgetId: string): void {
    this.content.removeWidget(widgetId);
  }

  hasWidget(widgetId: string): boolean {
    return this.content.get().items[widgetId] !== undefined;
  }

  selectWidget(widgetId: string): void {
    this.content.activateWidget(widgetId);
  }

  splitWidget(widgetId: string, side: Side): void {
    this.content.splitWidget(widgetId, side);
  }

  reorderWidgets(order: readonly string[]): void {
    this.content.reorderWidgets(order);
  }

  widgetOrder(): readonly string[] {
    return Object.entries(this.content.get().items)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
  }

  get boardState(): LayoutState<WidgetRecord> {
    return this.content.get();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unregister();
    this.content.dispose();
  }
}
