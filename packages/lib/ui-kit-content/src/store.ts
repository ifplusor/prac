/**
 * The layout store contract: one immutable state cell, subscribed to with
 * `useSyncExternalStore`.
 *
 * The kit owns the shape and the hook. A platform supplies the persisted
 * implementation; a board can implement the same contract over its own state.
 *
 * @module prac-ui-kit-content/store
 */

import { useSyncExternalStore } from "react";
import type { LayoutState, PlacementRecord } from "./placement.js";

/** The layout store: an immutable state cell with a subscription set. */
export interface LayoutStore<TRecord extends PlacementRecord = PlacementRecord> {
  get(this: void): LayoutState<TRecord>;
  subscribe(this: void, listener: () => void): () => void;
  update(this: void, updater: (state: LayoutState<TRecord>) => LayoutState<TRecord>): void;
  requestCloseView(this: void, itemId: string): void;
}

/** Subscribe a component to the whole layout state. */
export function useLayout<TRecord extends PlacementRecord>(
  store: LayoutStore<TRecord>,
): LayoutState<TRecord>;
/** Subscribe a component to a slice of the layout state. */
export function useLayout<TRecord extends PlacementRecord, T>(
  store: LayoutStore<TRecord>,
  selector: (state: LayoutState<TRecord>) => T,
): T;
export function useLayout<TRecord extends PlacementRecord, T>(
  store: LayoutStore<TRecord>,
  selector: (state: LayoutState<TRecord>) => T = (state) => state as unknown as T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
