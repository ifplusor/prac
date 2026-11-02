/**
 * A store that fronts one active store.
 *
 * The frame and the faces are built once over this switcher; switching changes
 * the active store and wakes the subscribers.
 *
 * @module prac-ui-kit-content/switching
 */

import type { PlacementRecord } from "./placement.js";
import type { LayoutStore } from "./store.js";

export interface SwitchingStore<
  TRecord extends PlacementRecord = PlacementRecord,
> extends LayoutStore<TRecord> {
  switchTo(store: LayoutStore<TRecord>): void;
  current(): LayoutStore<TRecord>;
}

/** Create a switcher over the initial store. */
export function createSwitchingStore<TRecord extends PlacementRecord>(
  initial: LayoutStore<TRecord>,
): SwitchingStore<TRecord> {
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
    requestCloseItem: (itemId) => active.requestCloseItem(itemId),
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
