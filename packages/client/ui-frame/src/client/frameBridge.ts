/**
 * Project a `WindowGroup` into the frame's placement store.
 *
 * The bridge is intentionally one-way: the runtime group is the authority for
 * membership, order and active; the frame store is the rendering projection. It
 * never reads the store back into the group.
 *
 * @module prac-client-ui-frame/client/frameBridge
 */

import { ensureStackShape, placeQuietly, removeView } from "./model.js";
import type { LayoutStore } from "./store.js";
import type { FrameWindowGroup } from "./frameGroups.js";

/** One group projected into one frame region. */
export class WindowGroupLayoutBridge {
  readonly #known = new Map<string, boolean>();
  readonly #stop: () => void;
  #disposed = false;

  constructor(
    private readonly group: FrameWindowGroup,
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
    const current = new Set(placements.map((placement) => placement.viewId));
    this.store.update((state) => {
      let next = state;
      for (const [viewId, owned] of this.#known) {
        // A hosted window the group does not own leaves the group, not the frame: the
        // owner still has it (an editor the workbench placed elsewhere).
        if (current.has(viewId) || !owned) continue;
        next = removeView(next, viewId);
      }
      for (const placement of placements) {
        // A person may have hidden this view through the frame's chrome. Group
        // membership is not a reason to bring it back; only an explicit show is.
        if (next.views[placement.viewId]?.hidden === true) continue;
        // A hosted window belongs to another owner: project it while it exists,
        // never mint a record for it.
        if (placement.owned === false && next.views[placement.viewId] === undefined) continue;
        const target = this.#targetFor(placement.viewId);
        if (target === undefined) continue;
        next = placeQuietly(next, placement.viewId, target);
      }
      const frontId =
        placements.find((placement) => placement.active)?.viewId ??
        (this.group.state.mode === "stack" ? placements[0]?.viewId : undefined);
      const views = { ...next.views };
      for (const placement of placements) {
        const record = views[placement.viewId];
        if (record === undefined) continue;
        views[placement.viewId] = {
          ...record,
          order: placement.order,
          front: placement.viewId === frontId,
        };
      }
      return ensureStackShape({ ...next, views });
    });
    this.#known.clear();
    for (const placement of placements) {
      this.#known.set(placement.viewId, placement.owned !== false);
    }
  }

  /**
   * A placement always addresses the registered node. `placeQuietly` already
   * routes a split id to its existing row and creates a row when there is none.
   */
  #targetFor(_viewId: string): string {
    return this.regionId;
  }

  /** Remove this bridge's placements and stop listening. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stop();
    this.store.update((state) => {
      let next = state;
      for (const [viewId, owned] of this.#known) {
        if (owned) next = removeView(next, viewId);
      }
      return ensureStackShape(next);
    });
    this.#known.clear();
  }
}
