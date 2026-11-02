/**
 * Generic placement: one item's position in a layout tree.
 *
 * Content types extend `PlacementRecord`; the store and tree functions only see
 * this base. The frame's `ViewRecord` (window / widget) is one such extension.
 *
 * @module prac-ui-kit-content/placement
 */

import type { LayoutNode } from "prac-ui-kit-layout";

/** Decoration a content declarer can set on its placement. */
export interface ViewFlags {
  readonly dirty?: boolean;
  readonly preview?: boolean;
  readonly closable?: boolean;
}

/** One item's placement, independent of what the item is. */
export interface PlacementRecord {
  /** Generic item kind; a content host may narrow it to window / widget / … */
  readonly kind?: string;
  /** Declared row height / cached size / ceiling, when the item declares one. */
  size?: number;
  cachedSize?: number;
  max?: number;
  /** Region id this item sits in. */
  region: string;
  /** Open order inside the region. */
  order: number;
  hidden: boolean;
  collapsed?: boolean;
  flags?: ViewFlags;
  /** Whether this is the item its region renders. */
  front?: boolean;
}

/** The whole layout state: geometry + the item table. */
export interface LayoutState<TRecord extends PlacementRecord = PlacementRecord> {
  /** Measured frame width, in px (0 until the first measurement). */
  viewportWidth: number;
  /** Measured frame height, in px. */
  viewportHeight: number;
  /** The region tree. */
  tree: LayoutNode;
  /** The item table: `itemId → placement`. */
  views: Record<string, TRecord>;
  /** Bumped when the content catalogue changes. */
  catalogueVersion: number;
  /** Source-selected main entry; null means the default. */
  activePanelId: string | null;
}

/** A region as the UI sees it. */
export interface RegionInfo {
  readonly id: string;
  readonly collapsed: boolean;
}
