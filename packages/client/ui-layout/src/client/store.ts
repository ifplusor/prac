/**
 * The layout store: one immutable state cell, subscribed to with
 * `useSyncExternalStore`.
 *
 * It knows nothing about placement rules (those are pure functions in `model`)
 * — it only commits their results and wakes subscribers.
 *
 * @module prac-client-ui-layout/client/store
 */

import { useSyncExternalStore } from "react";
import { type LayoutState } from "./contract.js";
import { defaultTree } from "./model.js";

// ── store ─────────────────────────────────────────────────────────────

/**
 * The layout store: an immutable state cell with a subscription set.
 *
 * The members are function-typed properties rather than methods: every one is a
 * closure over the store's own state, so they are safe to hand around unbound
 * (`pracLayout.getState`, `useSyncExternalStore`'s subscribe).
 */
export interface LayoutStore {
  /** The current state. */
  get: () => LayoutState;
  /**
   * Subscribe to state replacements.
   *
   * @param listener - called after every accepted update.
   * @returns an unsubscribe function.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Replace the state through a pure updater.
   *
   * @param updater - returns the next state, or the same reference to skip.
   */
  update: (updater: (state: LayoutState) => LayoutState) => void;
}

/**
 * Create the layout store.
 *
 * The view table starts empty on purpose: the mechanism ships no default
 * placement, so the arrangement is what puts `dsh:*` and `vscode:*` views into
 * regions.
 */
export function createStore(): LayoutStore {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    views: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
  const listeners = new Set<() => void>();
  const emit = (): void => {
    // Iterate a snapshot: a listener may unsubscribe while we emit, and live
    // Set iteration would then skip the next listener.
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    get: () => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Replace the state through a pure updater. */
    update: (updater: (current: LayoutState) => LayoutState): void => {
      const next = updater(state);
      if (next === state) return;
      state = next;
      emit();
    },
  };
}

/**
 * Subscribe a component to a slice of the layout store.
 *
 * @param store - the layout store.
 */
export function useLayout(store: LayoutStore): LayoutState;
/**
 * Subscribe a component to a slice of the layout store.
 *
 * @param store - the layout store.
 * @param selector - projects the state to the subscribed slice.
 */
export function useLayout<T>(store: LayoutStore, selector: (state: LayoutState) => T): T;
export function useLayout<T>(
  store: LayoutStore,
  selector: (state: LayoutState) => T = (state) => state as unknown as T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
