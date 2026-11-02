import type { ContentHost } from "prac-ui-kit-content";
import {
  type RegionContent,
  type Window,
  type WindowGroup,
  type WidgetRecord,
  type LayoutState,
  WindowGroupModel,
} from "prac-ui-kit-workbench";
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

/** A board window hosted as a surface with a generic window group. */
export class BoardWindowAdapter implements RegionContent<WindowGroup> {
  readonly kind = "window-group";
  readonly boardWindow: BoardWindow;
  readonly group: WindowGroupModel;
  readonly content: BoardContent;
  readonly windowId: string;
  readonly boardId: string;
  readonly label?: string;
  readonly #unregister: () => void;

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
    this.group = new WindowGroupModel(id, this.boardWindow, label);
    this.#unregister =
      frame?.registerBoardLayout(this.boardId, this.content, createBoardChrome(this.content)) ??
      (() => {});
  }

  get state(): WindowGroup["state"] {
    return this.group.state;
  }

  get placements(): WindowGroup["placements"] {
    return this.group.placements;
  }

  get windows(): WindowGroup["windows"] {
    return this.group.windows;
  }

  #element: HTMLElement | undefined;

  get element(): HTMLElement | undefined {
    return this.#element;
  }

  attach(element: HTMLElement): void {
    this.#element = element;
  }

  detach(element: HTMLElement): void {
    if (this.#element === element) this.#element = undefined;
  }

  onDidChange(listener: () => void): () => void {
    return this.group.onDidChange(listener);
  }

  reorder(order: readonly string[]): void {
    this.group.reorder(order);
  }

  openWindow(itemId: string): void {
    this.group.openWindow(itemId);
  }

  closeWindow(itemId: string): void {
    this.group.closeWindow(itemId);
  }

  activateWindow(itemId: string): void {
    this.group.activateWindow(itemId);
  }

  syncWindows(itemIds: readonly string[]): void {
    this.group.syncWindows(itemIds);
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

  get hostedWindows(): readonly string[] {
    return this.group.state.order;
  }

  get disposed(): boolean {
    return this.group.disposed;
  }

  dispose(): void {
    if (this.group.disposed) return;
    this.#unregister();
    this.group.dispose();
    this.content.dispose();
  }
}
