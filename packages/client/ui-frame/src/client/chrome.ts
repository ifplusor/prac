/**
 * Extensible chrome around a layout node.
 *
 * Layout geometry is fixed; chrome is not. A container registers contributions at
 * named anchors (`region.frame`, `region.tabs`, `region.footer`, …), optionally
 * declaring the space they reserve. The renderer asks the registry for each
 * anchor; it does not hardcode tab strips, headers or action bars.
 *
 * @module prac-client-ui-frame/client/chrome
 */
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import type { LayoutNode } from "prac-ui-kit";
import type { Box, GridPlacement, LayoutState, ViewRecord } from "./contract.js";

/**
 * Where a contribution renders around a node.
 *
 * Region anchors wrap the content; `split.sash` renders *between* two split
 * children; `grid.cell` renders inside one grid cell (before its content) and
 * `grid.track` between two grid tracks.
 */
export type ChromeAnchor =
  | "region.frame"
  | "region.tabs"
  | "region.header"
  | "region.footer"
  | "row.header"
  | "split.sash"
  | "region.overlay"
  | "grid.cell"
  | "grid.track";

/** Space a chrome contribution reserves from the node's content box. */
export interface ChromeMetrics {
  readonly inlineStart: number;
  readonly inlineEnd: number;
  readonly blockStart: number;
  readonly blockEnd: number;
}

/** Layout mutations chrome may request; chrome never writes the store directly. */
export interface LayoutIntents {
  activate(itemId: string): void;
  close(itemId: string): void;
  fold(nodeId: string, folded: boolean): void;
  resize(splitId: string, index: number, delta: number): void;
  reorder(anchor: string, itemId: string, before?: string): void;
}

/**
 * Dispatch one child slot.
 *
 * Chrome may render a container's keyed slots (an item's actions). The face comes
 * from the container that owns the renderer, so a board window's chrome renders
 * widget actions through the frame's slot dispatcher instead of a second one.
 */
export type ChromeSlotFace = (
  slot: string,
  props: Record<string, unknown>,
  options?: Record<string, unknown>,
) => ReactNode;

/** Presentation facts a container declares about one of its items. */
export interface ChromeItemFacts {
  /** The item's declared title. */
  readonly label?: string;
  /** The item's declared icon class (opaque to the renderer). */
  readonly icon?: string;
  /** Whether the item brings its own pane header (chrome overlays it instead of adding one). */
  readonly paneHeader?: boolean;
}

/**
 * Context passed to a contribution.
 *
 * The optional geometry fields are filled by the anchor that renders the
 * contribution: `index` / `offset` / `beforeId` / `afterId` for a `split.sash`,
 * `placement` / `shape` / `cellCount` / `child` for a `grid.cell`, and `track`
 * / `index` for a `grid.track`. A region anchor leaves them out.
 */
export interface ChromeContext<TRecord extends ViewRecord> {
  readonly state: LayoutState<TRecord>;
  readonly node: LayoutNode;
  readonly regionId: string;
  readonly itemId?: string;
  readonly intents?: LayoutIntents;
  /** The container's slot dispatcher, when it has one. */
  readonly slotFace?: ChromeSlotFace;
  /** The container's declared facts about one item (title / icon / pane header). */
  readonly itemFacts?: (itemId: string) => ChromeItemFacts;
  /** The node's allocation (or, for a grid cell, the cell's). */
  readonly box?: Box;
  /** Index among a split's present children, or among a grid's cells/tracks. */
  readonly index?: number;
  /** A split boundary's offset from the split's leading edge, in px. */
  readonly offset?: number;
  /** The region before a split boundary. */
  readonly beforeId?: string;
  /** The region after a split boundary. */
  readonly afterId?: string;
  /** The cell a `grid.cell` contribution renders inside (when known). */
  readonly child?: LayoutNode;
  /** A grid cell's effective placement. */
  readonly placement?: GridPlacement;
  /** The grid's drawn shape. */
  readonly shape?: { readonly rows: number; readonly columns: number };
  /** How many present cells the grid has. */
  readonly cellCount?: number;
  /** Which axis a `grid.track` contribution sits on. */
  readonly track?: "column" | "row";
}

/** One chrome part. */
export interface ChromeContribution<TRecord extends ViewRecord> {
  readonly id: string;
  readonly anchor: ChromeAnchor;
  readonly order?: number;
  render(ctx: ChromeContext<TRecord>): ReactNode;
  metrics?(ctx: ChromeContext<TRecord>): ChromeMetrics;
}

/** Per-container chrome registry. */
export class ChromeRegistry<TRecord extends ViewRecord> {
  readonly #items = new Map<string, ChromeContribution<TRecord>>();

  add(contribution: ChromeContribution<TRecord>): () => void {
    this.#items.set(contribution.id, contribution);
    return () => this.remove(contribution.id);
  }

  remove(id: string): void {
    this.#items.delete(id);
  }

  list(anchor: ChromeAnchor): readonly ChromeContribution<TRecord>[] {
    return [...this.#items.values()]
      .filter((item) => item.anchor === anchor)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** Render every contribution at one anchor. */
  render(anchor: ChromeAnchor, ctx: ChromeContext<TRecord>): ReactNode {
    const items = this.list(anchor);
    if (items.length === 0) return null;
    return createElement(
      Fragment,
      null,
      items.map((item) => createElement(Fragment, { key: item.id }, item.render(ctx))),
    );
  }

  /** Total inset for a node; absent contributions contribute zero. */
  metrics(anchor: ChromeAnchor, ctx: ChromeContext<TRecord>): ChromeMetrics {
    let inlineStart = 0;
    let inlineEnd = 0;
    let blockStart = 0;
    let blockEnd = 0;
    for (const item of this.list(anchor)) {
      const metrics = item.metrics?.(ctx);
      if (metrics === undefined) continue;
      inlineStart += metrics.inlineStart;
      inlineEnd += metrics.inlineEnd;
      blockStart += metrics.blockStart;
      blockEnd += metrics.blockEnd;
    }
    return { inlineStart, inlineEnd, blockStart, blockEnd };
  }
}
