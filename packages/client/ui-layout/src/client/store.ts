/**
 * The layout store: one immutable state cell, subscribed to with
 * `useSyncExternalStore`.
 *
 * The cell is DSH's own snapshot store engine (`dsh-client-store`), used with
 * its opt-in persistence: the frame's state — the region tree (sizes, collapse,
 * stack order) and the view table (where each view sits, whether it is hidden,
 * whether it is folded) — survives a reload. Attention (`activePanelId`) and the
 * measured viewport survive too; they are simply overwritten on the next measure
 * or click.
 *
 * The store engine is a **platform word**: DSH's shell seeds it into the
 * loader's module table as a singleton, so the client artifact requires it
 * rather than inlining a second zustand/immer behind its own state (see
 * `clientPack`'s `external` in `vite.config.ts`).
 *
 * The **key is versioned**: the engine rehydrates whatever is under it without
 * validating the shape, so a state shape that changes must move to a new key
 * rather than read a stale one.
 *
 * It knows nothing about placement rules (those are pure functions in `model`)
 * — it only commits their results and wakes subscribers.
 *
 * @module prac-client-ui-layout/client/store
 */

import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { useSyncExternalStore } from "react";
import { type LayoutState } from "./contract.js";
import { defaultTree } from "./model.js";

/** The persisted state's key. Bump the version when the shape changes. */
export const STATE_KEY = "prac-layout/v2";

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
  const initial: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    views: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
  // `flush: "raf"` batches a burst of updates into one frame; persistence writes
  // on every committed state, under one key this origin shares (see `STATE_KEY`:
  // localStorage is per origin, so two DSH tabs on the same origin are not
  // separated yet — the per-workspace scope is deferred).
  const snapshot = createSnapshotStore<LayoutState>(initial, {
    flush: "raf",
    persist: { name: STATE_KEY },
  });
  return {
    get: () => snapshot.getSnapshot(),
    subscribe: (listener: () => void): (() => void) => snapshot.subscribe(listener),
    /** Replace the state through a pure updater. */
    update: (updater: (current: LayoutState) => LayoutState): void => {
      const current = snapshot.getSnapshot();
      const next = updater(current);
      if (next === current) return;
      snapshot.set(next);
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
