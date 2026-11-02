/**
 * Project a `WindowGroup` into the frame's placement store.
 *
 * The bridge is intentionally one-way: the runtime group is the authority for
 * membership, order and active; the frame store is the rendering projection. It
 * never reads the store back into the group.
 *
 * @module prac-ui-kit-workbench/groupBridge
 */

import { ensureStackShape, placeQuietly, removeItem } from "prac-ui-kit-content";
import type { LayoutStore } from "./store.js";
import type { WindowGroup } from "./workbenchModel.js";

/** One group projected into one frame region. */
export class WindowGroupLayoutBridge {
  readonly #known = new Map<string, boolean>();
  readonly #stop: () => void;
  #disposed = false;

  constructor(
    private readonly group: WindowGroup,
    private readonly store: LayoutStore,
    readonly regionId: string,
  ) {
    this.#stop = group.onDidChange(() => this.sync());
    this.sync();
  }

  /** Re-project the group's current placements. */
  sync(): void {
    if (this.#disposed) return;
    const placements = this.group.placements;
    const current = new Set(placements.map((placement) => placement.itemId));
    this.store.update((state) => {
      let next = state;
      for (const [itemId, owned] of this.#known) {
        // A hosted window the group does not own leaves the group, not the frame: the
        // owner still has it (an editor the workbench placed elsewhere).
        if (current.has(itemId) || !owned) continue;
        next = removeItem(next, itemId);
      }
      for (const placement of placements) {
        // A person may have hidden this view through the frame's chrome. Group
        // membership is not a reason to bring it back; only an explicit show is.
        if (next.items[placement.itemId]?.hidden === true) continue;
        // A hosted window belongs to another owner: project it while it exists,
        // never mint a record for it.
        if (placement.owned === false && next.items[placement.itemId] === undefined) continue;
        const target = this.#targetFor(placement.itemId);
        if (target === undefined) continue;
        next = placeQuietly(next, placement.itemId, target);
      }
      const frontId =
        placements.find((placement) => placement.active)?.itemId ??
        (this.group.state.mode === "stack" ? placements[0]?.itemId : undefined);
      const items = { ...next.items };
      for (const placement of placements) {
        const record = items[placement.itemId];
        if (record === undefined) continue;
        items[placement.itemId] = {
          ...record,
          order: placement.order,
          front: placement.itemId === frontId,
        };
      }
      return ensureStackShape({ ...next, items });
    });
    this.#known.clear();
    for (const placement of placements) {
      this.#known.set(placement.itemId, placement.owned !== false);
    }
  }

  /**
   * A placement always addresses the registered node. `placeQuietly` already
   * routes a split id to its existing row and creates a row when there is none.
   */
  #targetFor(_itemId: string): string {
    return this.regionId;
  }

  /** Remove this bridge's placements and stop listening. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stop();
    this.store.update((state) => {
      let next = state;
      for (const [itemId, owned] of this.#known) {
        if (owned) next = removeItem(next, itemId);
      }
      return ensureStackShape(next);
    });
    this.#known.clear();
  }
}
