/**
 * A board window: a `WindowGroup` with one window whose content is a board.
 *
 * This is the target model's sidebar / panel shape — a region's surface is a
 * window group, and the board is the content of its one window, not a group of
 * its own. The frame projects the group's single window as a `ViewRecord`; the
 * board's own `LayoutState<WidgetRecord>` lays out the widgets inside it.
 *
 * @module prac-client-ui-widget/client/boardWindowGroup
 */
import type { Surface } from "prac-ui-kit-frame";
import type {
  ContentHost,
  LayoutState,
  Side,
  WindowGroup as FrameWindowGroup,
  WindowGroupPlacement,
  WindowGroupState,
  WidgetRecord,
} from "prac-ui-kit-frame";
import { BoardContent, type WidgetPlacementOptions } from "./boardContent.js";
import { createBoardChrome } from "./boardChrome.js";

/** The frame facts a board window registers (the service owns the frame face). */
export interface BoardWindowFrameFace {
  registerBoardLayout(
    boardId: string,
    source: BoardContent,
    chrome: ReturnType<typeof createBoardChrome>,
  ): () => void;
  setViewBoard(viewId: string, boardId: string | undefined): void;
}

/** What the group's one window renders. */
export interface BoardWindowContent extends ContentHost {
  readonly kind: "board";
  readonly activeWidget: string | undefined;
}

/** A board hosted as a window group's single window. */
export class BoardWindowGroup implements Surface<FrameWindowGroup> {
  readonly kind = "window-group";
  /** The frame record this group projects (also the board's layout root id). */
  readonly windowId: string;
  readonly boardId: string;
  readonly content: BoardContent;
  readonly #unregister: () => void;
  readonly #listeners = new Set<() => void>();
  /** Windows the group hosts besides the board window (an editor window, say). */
  readonly #extra: string[] = [];
  #active: string;
  #element: HTMLElement | undefined;
  #disposed = false;

  constructor(
    readonly id: string,
    readonly label?: string,
    frame?: BoardWindowFrameFace,
  ) {
    this.windowId = `${id}/board`;
    this.boardId = this.windowId;
    this.#active = this.windowId;
    this.content = new BoardContent(this.boardId);
    this.#unregister =
      frame?.registerBoardLayout(this.boardId, this.content, createBoardChrome(this.content)) ??
      (() => {});
  }

  /** The surface's group (a board window group of one window). */
  get group(): FrameWindowGroup {
    return this;
  }

  /** Every window this group hosts, board window first. */
  #order(): readonly string[] {
    return [this.windowId, ...this.#extra];
  }

  /** The window-group projection the frame consumes. */
  get state(): WindowGroupState {
    return {
      id: this.id,
      mode: "select",
      ...(this.label === undefined ? {} : { label: this.label }),
      active: this.#active,
      order: this.#order(),
    };
  }

  get placements(): readonly WindowGroupPlacement[] {
    return this.#order().map((viewId, order) => ({
      itemId: viewId,
      viewId,
      groupId: this.id,
      order,
      active: viewId === this.#active,
      visible: true,
      // The board window is the group's own; a window hosted beside it (an editor) is
      // the workbench's, so leaving the group must not delete its record.
      ...(viewId === this.windowId ? {} : { owned: false }),
    }));
  }

  /** The window identity: one window, whose content is this board. */
  get windows(): readonly { id: string; appId: string; content: BoardWindowContent }[] {
    return [
      { id: this.windowId, appId: "prac.board", content: this.content as BoardWindowContent },
    ];
  }

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
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reorder(order: readonly string[]): void {
    const current = new Set(this.#order());
    if (order.length !== current.size || order.some((id) => !current.has(id))) {
      throw new Error(`board window group ${this.id}: order must be a permutation of its windows`);
    }
    this.#extra.splice(0, this.#extra.length, ...order.filter((id) => id !== this.windowId));
    this.#emit();
  }

  /**
   * Host another window (an editor window) beside the board.
   *
   * The group's state carries its identity; the frame projects the record, so the
   * sidebar's WindowGroup is not limited to the board window it starts with.
   */
  openWindow(viewId: string): void {
    if (viewId === this.windowId || this.#extra.includes(viewId)) return;
    this.#extra.push(viewId);
    this.#active = viewId;
    this.#emit();
  }

  /**
   * Close a hosted window. The board window itself cannot be closed this way.
   *
   * The group owns the window's projection while it hosts it: closing drops the
   * record too. Use it for windows the group opened; a window another group owns
   * should be handed back before it closes (see the open question in the worklog
   * about stable window identity vs. file-placement ids).
   */
  closeWindow(viewId: string): void {
    const index = this.#extra.indexOf(viewId);
    if (index === -1) return;
    this.#extra.splice(index, 1);
    if (this.#active === viewId) this.#active = this.windowId;
    this.#emit();
  }

  /**
   * Set the windows hosted **beside** the board from the frame's records.
   *
   * The workbench owns file windows, so this is a projection of its placements: the
   * group lists them (state / placements), and the frame's bridge follows them while
   * they are members without ever minting or deleting their records.
   *
   * @param windows - the window ids in region order (the board window is ignored).
   */
  syncWindows(windows: readonly string[]): void {
    const next = windows.filter((viewId) => viewId !== this.windowId);
    if (
      next.length === this.#extra.length &&
      next.every((id, index) => id === this.#extra[index])
    ) {
      return;
    }
    this.#extra.splice(0, this.#extra.length, ...next);
    if (!this.#order().includes(this.#active)) this.#active = this.windowId;
    this.#emit();
  }

  /** Make one hosted window active. */
  activateWindow(viewId: string): void {
    if (!this.#order().includes(viewId)) throw new Error(`unknown window: ${viewId}`);
    if (this.#active === viewId) return;
    this.#active = viewId;
    this.#emit();
  }

  /** Place a widget on the board. */
  addWidget(widgetId: string, options?: WidgetPlacementOptions): void {
    this.content.placeWidget(widgetId, this.boardId, options);
    this.#emit();
  }

  /** Remove a widget from the board. */
  removeWidget(widgetId: string): void {
    this.content.removeWidget(widgetId);
    this.#emit();
  }

  /** Whether the board currently holds a widget. */
  hasWidget(widgetId: string): boolean {
    return this.content.get().views[widgetId] !== undefined;
  }

  /** Make one widget the board's active widget. */
  selectWidget(widgetId: string): void {
    this.content.activateWidget(widgetId);
    this.#emit();
  }

  /** Split one widget out inside this board's root. */
  splitWidget(widgetId: string, side: Side): void {
    this.content.splitWidget(widgetId, side);
    this.#emit();
  }

  /** Reorder the board's widgets. */
  reorderWidgets(order: readonly string[]): void {
    this.content.reorderWidgets(order);
    this.#emit();
  }

  /** The board's widget ids in layout order. */
  widgetOrder(): readonly string[] {
    return Object.entries(this.content.get().views)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
  }

  /** The board root state, for diagnostics / gates. */
  get boardState(): LayoutState<WidgetRecord> {
    return this.content.get();
  }

  /** The windows this group hosts, board window first. */
  get hostedWindows(): readonly string[] {
    return this.#order();
  }

  /** Whether this group has been disposed. */
  get disposed(): boolean {
    return this.#disposed;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unregister();
    this.#listeners.clear();
    this.content.dispose();
  }
}
