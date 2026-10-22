/**
 * The frame's owner of view groups.
 *
 * One view-group id maps to one frame region. The host owns the bridge that
 * projects the group into the layout store; it does not own the group runtime
 * (the resource materializer does) and it does not create regions (the
 * arrangement does).
 *
 * @module prac-client-ui-layout/client/frameGroups
 */

import { findRegion } from "./model.js";
import type { GroupBinding, ViewGroupRuntime } from "./resource.js";
import type { LayoutStore } from "./store.js";
import { ViewGroupLayoutBridge } from "./frameBridge.js";
import type { ViewGroupPlacement, ViewGroupState } from "./viewGroup.js";

/** The structural group shape the frame consumes. */
export interface FrameViewGroup extends ViewGroupRuntime {
  readonly id: string;
  readonly state: ViewGroupState;
  readonly placements: readonly ViewGroupPlacement[];
  onDidChange(listener: () => void): () => void;
  setBinding?(binding: GroupBinding | undefined): void;
}

/** One registered group and its frame region. */
export interface FrameGroup {
  readonly group: FrameViewGroup;
  readonly regionId: string;
  readonly bridge: ViewGroupLayoutBridge;
}

/** Owns the group → region bindings for one frame store. */
export class ViewGroupHost {
  readonly #groups = new Map<string, FrameGroup>();
  readonly #regions = new Map<string, string>();

  constructor(private readonly store: LayoutStore) {}

  /** Register a group in an existing region. */
  register(group: FrameViewGroup, regionId: string): FrameGroup {
    if (this.#groups.has(group.id)) throw new Error(`view group already registered: ${group.id}`);
    if (this.#regions.has(regionId)) {
      throw new Error(`region already hosts a view group: ${regionId}`);
    }
    if (findRegion(this.store.get().tree, regionId) === null) {
      throw new Error(`unknown region: ${regionId}`);
    }
    const bridge = new ViewGroupLayoutBridge(group, this.store, regionId);
    const frameGroup: FrameGroup = { group, regionId, bridge };
    this.#groups.set(group.id, frameGroup);
    this.#regions.set(regionId, group.id);
    return frameGroup;
  }

  /** Look up a registered group. */
  get(groupId: string): FrameGroup | undefined {
    return this.#groups.get(groupId);
  }

  /** Remove a group's frame projection. The group runtime itself is not disposed. */
  unregister(groupId: string): void {
    const frameGroup = this.#groups.get(groupId);
    if (!frameGroup) return;
    this.#groups.delete(groupId);
    this.#regions.delete(frameGroup.regionId);
    frameGroup.bridge.dispose();
  }

  /** Remove every frame projection; groups themselves are not disposed. */
  dispose(): void {
    for (const groupId of this.#groups.keys()) this.unregister(groupId);
  }
}
