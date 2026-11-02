/**
 * The runtime content of a board window.
 *
 * This is the target shape: a board is a **window content**, not a view group.
 * It owns the widget order / active widget and exposes each placed widget as a
 * `WidgetHost`. The frame mounts the board into the window's content element;
 * individual widgets keep their own content hosts.
 *
 * The board is rendered by the frame's `LayoutRenderer`; this class owns only its
 * state and the widget hosts.
 *
 * @module prac-client-ui-widget/client/boardContent
 */

import type { LayoutRoot } from "prac-ui-kit-workbench";
import {
  ensureStackShape,
  freshNodeId,
  place,
  regionNode,
  removeItem,
  setFront,
  setItemCollapsed,
  setItemSize,
  splitRegionWith,
  structuralRegion,
  workspaceScope,
  type LayoutState,
  type Side,
  type WidgetRecord,
} from "prac-ui-kit-workbench";
import { WidgetBoard } from "./board.js";

/** A board child: a widget identity plus its content host. */
export interface BoardWidgetHost {
  readonly id: string;
  mount(element: HTMLElement): void;
  release(): void;
  focus?(): void;
}

/** The target shape of a board as window content. */
export interface BoardContentShape {
  readonly id: string;
  readonly kind: "board";
  readonly widgets: readonly BoardWidgetHost[];
  readonly activeWidget: string | undefined;
  mount(element: HTMLElement): void;
  release(): void;
  focus?(): void;
  setPlacement(order: readonly string[], active: string | undefined): void;
}

/**
 * What a widget declares about its place in the board.
 *
 * The frame's `setItemSize` / `setItemCollapsed` are declarations that the
 * layout only reads: a widget keeps them across a reorder and loses them to
 * nobody. A second widget turns the board root into a stack of rows, and the
 * declarations move into the rows (see `ensureStackShape`).
 */
export interface WidgetPlacementOptions {
  /** A height claim for the widget's stack row, in px. */
  readonly size?: number;
  /** Start folded (header only). */
  readonly folded?: boolean;
}

/** How a board remembers its layout between page loads. */
export interface BoardContentOptions {
  /** A storage key, or `false` to stay in memory (tests, throwaway boards). */
  readonly persist?: string | false;
}

/**
 * The storage key for one board: the same workspace scope the frame's layout uses.
 *
 * A board's tree (widget order, row heights, folds) belongs to the project folder,
 * like every other layout fact — two folders must not inherit each other's rows.
 */
export function boardStorageKey(id: string): string {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return `prac-board/v1/${workspaceScope(search)}/${id}`;
}

/** Whether a hydrated tree looks like a board layout at all. */
function looksLikeBoard(value: unknown): value is LayoutState<WidgetRecord> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { tree?: unknown; items?: unknown };
  return (
    typeof candidate.tree === "object" &&
    candidate.tree !== null &&
    typeof (candidate.tree as { type?: unknown }).type === "string" &&
    typeof candidate.items === "object" &&
    candidate.items !== null
  );
}

/** A board as window content. */
export class BoardContent implements BoardContentShape {
  readonly kind = "board" as const;
  readonly #board: WidgetBoard;
  readonly #hosts = new Map<string, BoardWidgetHost>();
  readonly #listeners = new Set<() => void>();
  #state: LayoutState<WidgetRecord>;
  readonly #storage: string | false;
  #pending: ReturnType<typeof setTimeout> | undefined;
  /** A counter for generated node ids (splits / regions). */
  #nodeSeq = 0;

  constructor(
    readonly id: string,
    /** The board's own layout tree; widgets are its items. */
    readonly layoutRoot?: LayoutRoot,
    options: BoardContentOptions = {},
  ) {
    this.#board = new WidgetBoard(id);
    this.#storage = options.persist ?? boardStorageKey(id);
    this.#state = this.#hydrate() ?? {
      viewportWidth: 0,
      viewportHeight: 0,
      // The board root is a **stack**: two or more widgets become rows with headers, the
      // way a sidebar board reads. A lone widget stays a bare region (no header).
      tree: regionNode(id, 0, { stack: true }),
      items: {},
      catalogueVersion: 0,
      activePanelId: null,
    };
    // A hydrated layout is the board's truth; bring the placement model (active / order)
    // onto it before anyone subscribes.
    this.#syncPlacements();
  }

  /** Read the board's last layout for this workspace, if it is usable. */
  #hydrate(): LayoutState<WidgetRecord> | undefined {
    if (this.#storage === false || typeof localStorage === "undefined") return undefined;
    try {
      const raw = localStorage.getItem(this.#storage);
      if (raw === null) return undefined;
      const parsed: unknown = JSON.parse(raw);
      return looksLikeBoard(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Write the board's layout back after a quiet moment (a drag writes many states). */
  #schedulePersist(): void {
    if (this.#storage === false || typeof localStorage === "undefined") return;
    if (this.#pending !== undefined) return;
    this.#pending = setTimeout(() => {
      this.#pending = undefined;
      this.#write();
    }, 150);
  }

  #write(): void {
    if (this.#storage === false || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.#storage, JSON.stringify(this.#state));
    } catch {
      // Storage full / disabled: the board keeps working in memory.
    }
  }

  get widgets(): readonly BoardWidgetHost[] {
    return this.#board.placements
      .map((placement) => this.#hosts.get(placement.widgetId))
      .filter((host): host is BoardWidgetHost => host !== undefined);
  }

  get activeWidget(): string | undefined {
    return this.#board.state.active;
  }

  /** Register a widget host with the board; placement is explicit. */
  addWidget(host: BoardWidgetHost): void {
    this.#hosts.set(host.id, host);
  }

  removeWidget(id: string): void {
    this.#hosts.delete(id);
    this.#board.remove(id);
    this.#set(removeItem(this.#state, id) as LayoutState<WidgetRecord>);
  }

  /** The board root's layout state; widgets are its items. */
  get state(): LayoutState<WidgetRecord> {
    return this.#state;
  }

  /** Subscribe to board layout mutations. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Current board layout state (the store's `get`). */
  get(): LayoutState<WidgetRecord> {
    return this.#state;
  }

  /** Replace the board layout through a pure updater. */
  update(updater: (state: LayoutState<WidgetRecord>) => LayoutState<WidgetRecord>): void {
    this.#set(updater(this.#state));
  }

  /** The board chrome asks to close a widget; the source owns what closing means. */
  requestCloseItem(widgetId: string): void {
    this.removeWidget(widgetId);
  }

  /** Place a widget in the board root (or a named region inside it). */
  placeWidget(
    widgetId: string,
    regionId: string = this.id,
    options: WidgetPlacementOptions = {},
  ): void {
    let next = place(this.#state, widgetId, regionId, (id) => ({
      region: regionId,
      order: 0,
      hidden: false,
      kind: "widget",
      contentId: id,
    })) as LayoutState<WidgetRecord>;
    if (options.size !== undefined) {
      next = setItemSize(next, widgetId, options.size) as LayoutState<WidgetRecord>;
    }
    if (options.folded === true) {
      next = setItemCollapsed(next, widgetId, true) as LayoutState<WidgetRecord>;
    }
    this.#set(next);
  }

  /**
   * Move a widget onto a region's structural container, then optionally split it.
   *
   * A stack row is a leaf holding one widget; placing directly into it would put
   * two widgets in one row. `structuralRegion` lifts the target to the stack /
   * container, so a center drop appends a row and an edge drop splits the target.
   */
  moveWidgetTo(
    widgetId: string,
    regionId: string,
    side?: "left" | "right" | "top" | "bottom",
  ): void {
    const source = this.#state.items[widgetId]?.region;
    if (source === undefined) return;
    const target = structuralRegion(this.#state.tree, regionId);
    const sourceHome = structuralRegion(this.#state.tree, source);
    if (sourceHome === target) {
      // Same stack: a drop on a row is a reorder, not a second row.
      const targetId = Object.entries(this.#state.items).find(
        ([, record]) => record.region === regionId,
      )?.[0];
      const order = Object.entries(this.#state.items)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id]) => id)
        .filter((id) => id !== widgetId);
      const at = targetId === undefined ? order.length : Math.max(0, order.indexOf(targetId));
      order.splice(at, 0, widgetId);
      const items = Object.fromEntries(
        Object.entries(this.#state.items).map(([id, record]) => [
          id,
          { ...record, order: order.indexOf(id) },
        ]),
      );
      this.#set(ensureStackShape({ ...this.#state, items }) as LayoutState<WidgetRecord>);
    } else {
      // Different container: leave the old row, then land in the target stack.
      const cleared = removeItem(this.#state, widgetId) as LayoutState<WidgetRecord>;
      const next = place(cleared, widgetId, target, (id) => ({
        region: target,
        order: 0,
        hidden: false,
        kind: "widget",
        contentId: id,
      })) as LayoutState<WidgetRecord>;
      this.#set(next);
    }
    if (side !== undefined) this.splitWidget(widgetId, side as Side);
  }

  /** Make one widget the board's active / front widget. */
  activateWidget(widgetId: string): void {
    this.#board.activate(widgetId);
    this.#set(setFront(this.#state, widgetId) as LayoutState<WidgetRecord>);
  }

  /** Reorder the board's widgets; the set must match the placed widgets. */
  reorderWidgets(order: readonly string[]): void {
    const position = new Map(order.map((id, index) => [id, index]));
    const items = Object.fromEntries(
      Object.entries(this.#state.items).map(([id, record]) => [
        id,
        position.has(id) ? { ...record, order: position.get(id)! } : record,
      ]),
    );
    // The rows are tree children: their order has to follow the new `order` values,
    // or the board would report one order and draw another.
    this.#set(ensureStackShape({ ...this.#state, items }) as LayoutState<WidgetRecord>);
  }

  /** Fold / unfold one widget's row, measuring the drawn height when the caller has it. */
  setWidgetCollapsed(widgetId: string, collapsed: boolean, measuredHeight?: number): void {
    this.#set(
      setItemCollapsed(
        this.#state,
        widgetId,
        collapsed,
        measuredHeight,
      ) as LayoutState<WidgetRecord>,
    );
  }

  /** Declare one widget row's height. */
  setWidgetSize(widgetId: string, size: number): void {
    this.#set(setItemSize(this.#state, widgetId, size) as LayoutState<WidgetRecord>);
  }

  /**
   * Split one widget out into a new region **inside this board root**.
   *
   * A cross-board move never merges two boards: the widget arrives first, then a
   * split is completed here, in the target board's own layout root.
   */
  splitWidget(widgetId: string, side: Side): void {
    const record = this.#state.items[widgetId];
    if (record?.region === undefined) return;
    this.#nodeSeq += 1;
    const splitId = freshNodeId(this.#state.tree, "split", () => this.#nodeSeq);
    const newRegionId = freshNodeId(this.#state.tree, "region", () => this.#nodeSeq);
    // Address the region the widget's home **stands for**: a stack row's split belongs to
    // the stack's container, not inside the row.
    const next = splitRegionWith(
      this.#state,
      structuralRegion(this.#state.tree, record.region),
      side,
      splitId,
      newRegionId,
      { gridCells: true },
    );
    if (next === this.#state) return;
    this.#set(place(next, widgetId, newRegionId) as LayoutState<WidgetRecord>);
  }

  /** Keep the placement model (order / active) on the layout's records. */
  #syncPlacements(): void {
    const ids = Object.entries(this.#state.items)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([widgetId]) => widgetId);
    const known = new Set(this.#board.state.order);
    for (const widgetId of this.#board.state.order) {
      if (!ids.includes(widgetId)) this.#board.remove(widgetId);
    }
    for (const widgetId of ids) if (!known.has(widgetId)) this.#board.place(widgetId);
    const front = ids.find((widgetId) => this.#state.items[widgetId]?.front === true) ?? ids[0];
    if (front !== undefined) this.#board.activate(front);
  }

  #set(next: LayoutState<WidgetRecord>): void {
    if (next === this.#state) return;
    this.#state = next;
    this.#syncPlacements();
    this.#schedulePersist();
    for (const listener of this.#listeners) listener();
  }

  mount(_element: HTMLElement): void {
    // The frame owns the board's DOM; widgets mount themselves.
  }

  release(): void {
    // Nothing to release: the board owns no element of its own.
  }

  focus(): void {
    const active = this.activeWidget;
    if (active !== undefined) this.#hosts.get(active)?.focus?.();
  }

  setPlacement(order: readonly string[], active: string | undefined): void {
    for (const id of order) {
      if (!this.#hosts.has(id))
        this.#hosts.set(id, this.#hosts.get(id) ?? { id, mount: () => {}, release: () => {} });
    }
    this.#board.reorder(order);
    if (active !== undefined) this.#board.activate(active);
  }

  /** The board's own data model, for the legacy adapter while it exists. */
  get board(): WidgetBoard {
    return this.#board;
  }

  dispose(): void {
    if (this.#pending !== undefined) {
      clearTimeout(this.#pending);
      this.#pending = undefined;
      this.#write();
    }
    this.#hosts.clear();
    this.#board.dispose();
  }
}
