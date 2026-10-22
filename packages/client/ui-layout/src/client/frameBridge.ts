/**
 * Project a `ViewGroup` into the frame's placement store.
 *
 * The bridge is intentionally one-way: the runtime group is the authority for
 * membership, order and active; the frame store is the rendering projection. It
 * never reads the store back into the group.
 *
 * @module prac-client-ui-layout/client/frameBridge
 */

import { ensureStackShape, placeQuietly, removeView } from "./model.js";
import type { LayoutStore } from "./store.js";
import type { FrameViewGroup } from "./frameGroups.js";

/** One group projected into one frame region. */
export class ViewGroupLayoutBridge {
  readonly #known = new Set<string>();
  readonly #stop: () => void;
  #disposed = false;

  constructor(
    private readonly group: FrameViewGroup,
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
      for (const viewId of this.#known) {
        if (!current.has(viewId)) next = removeView(next, viewId);
      }
      for (const placement of placements) {
        // A person may have hidden this view through the frame's chrome. Group
        // membership is not a reason to bring it back; only an explicit show is.
        if (next.views[placement.viewId]?.hidden === true) continue;
        next = placeQuietly(next, placement.viewId, this.regionId);
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
    for (const viewId of current) this.#known.add(viewId);
  }

  /** Remove this bridge's placements and stop listening. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stop();
    this.store.update((state) => {
      let next = state;
      for (const viewId of this.#known) next = removeView(next, viewId);
      return ensureStackShape(next);
    });
    this.#known.clear();
  }
}
