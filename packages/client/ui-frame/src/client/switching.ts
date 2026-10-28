/**
 * A store that fronts one active Space store.
 *
 * Each Space owns a `LayoutStore` (its own persisted layout). The frame and the
 * faces are built once over this switcher; switching changes the active store
 * and wakes the subscribers, so the frame re-renders the new Space's layout
 * without rebuilding the mechanism.
 *
 * @module prac-client-ui-frame/client/switching
 */

import type { LayoutStore } from "./store.js";

/** A store that fronts one active Space store. */
export interface SwitchingStore extends LayoutStore {
  /** Make another Space's store the active one. */
  switchTo(store: LayoutStore): void;
  /** The active Space's store. */
  current(): LayoutStore;
}

/** Create a switcher over the initial Space's store. */
export function createSwitchingStore(initial: LayoutStore): SwitchingStore {
  let active = initial;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };
  let offActive = active.subscribe(notify);
  return {
    get: () => active.get(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (updater) => active.update(updater),
    requestCloseView: (viewId) => active.requestCloseView(viewId),
    switchTo: (next) => {
      if (next === active) return;
      offActive();
      active = next;
      offActive = active.subscribe(notify);
      notify();
    },
    current: () => active,
  };
}
