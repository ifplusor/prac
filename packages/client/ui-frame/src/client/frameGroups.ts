/**
 * The frame's owner of view groups.
 *
 * One view-group id maps to one frame region. The host owns the bridge that
 * projects the group into the layout store; it does not own the group runtime
 * (the resource materializer does) and it does not create regions (the
 * arrangement does).
 *
 * @module prac-client-ui-frame/client/frameGroups
 */

import { findRegion } from "./model.js";
import type {
  GroupAction,
  GroupActionBinding,
  GroupBinding,
  ViewGroupRuntime,
} from "./contracts.js";
import type { LayoutStore } from "./store.js";
import { ViewGroupLayoutBridge } from "./frameBridge.js";
import type { ViewGroupPlacement, ViewGroupState } from "./viewGroup.js";
import type { Surface } from "./surface.js";

/** The structural group shape the frame consumes. */
export interface FrameViewGroup extends ViewGroupRuntime {
  readonly id: string;
  readonly state: ViewGroupState;
  readonly binding?: GroupBinding;
  readonly placements: readonly ViewGroupPlacement[];
  onDidChange(listener: () => void): () => void;
  reorder(order: readonly string[]): void;
  setBinding?(binding: GroupBinding | undefined): void;
}

/** One bar entry projected from a hosted group. */
export interface GroupBarItem {
  readonly groupId: string;
  readonly regionId: string;
  readonly label: string;
  readonly active?: string;
  readonly actions?: readonly GroupAction[];
  readonly runAction?: (actionId: string) => void;
}

/** One registered group and its frame region. */
export interface FrameGroup {
  /** The surface registered for this region. */
  readonly surface: Surface;
  /** Convenience view of `surface.group`. */
  readonly group: FrameViewGroup;
  readonly regionId: string;
  readonly bridge: ViewGroupLayoutBridge;
}

/** Owns the group → region bindings for one frame store. */
export class ViewGroupHost {
  readonly #groups = new Map<string, FrameGroup>();
  readonly #regions = new Map<string, string>();
  readonly #stop: () => void;

  constructor(private readonly store: LayoutStore) {
    this.#stop = store.subscribe(() => this.#syncOrderFromStore());
  }

  /** Register a group in an existing region. */
  register(group: FrameViewGroup, regionId: string, surface?: Surface): FrameGroup {
    if (this.#groups.has(group.id)) throw new Error(`view group already registered: ${group.id}`);
    if (this.#regions.has(regionId)) {
      throw new Error(`region already hosts a view group: ${regionId}`);
    }
    if (findRegion(this.store.get().tree, regionId) === null) {
      throw new Error(`unknown region: ${regionId}`);
    }
    const bridge = new ViewGroupLayoutBridge(group, this.store, regionId);
    const owningSurface: Surface = surface ?? {
      kind: group.state.mode === "select" ? "window-group" : "widget-board",
      group,
      dispose: () => group.dispose(),
    };
    const frameGroup: FrameGroup = {
      surface: owningSurface,
      get group() {
        return owningSurface.group;
      },
      regionId,
      bridge,
    };
    this.#groups.set(group.id, frameGroup);
    this.#regions.set(regionId, group.id);
    return frameGroup;
  }

  /** Register a surface's group in a region. */
  registerSurface(surface: Surface, regionId: string): FrameGroup {
    return this.register(surface.group, regionId, surface);
  }

  /** One group bar item: the group hosted in a region and which member is active. */
  barItems(regionId: string): readonly GroupBarItem[] {
    return [...this.#groups.values()]
      .filter((entry) => entry.regionId === regionId || entry.regionId.startsWith(`${regionId}/`))
      .map((entry) => {
        const binding = entry.group.binding as Partial<GroupActionBinding> | undefined;
        return {
          groupId: entry.group.id,
          regionId: entry.regionId,
          label: entry.group.state.label ?? entry.group.id,
          ...(entry.group.state.active === undefined ? {} : { active: entry.group.state.active }),
          ...(typeof binding?.actions === "function"
            ? {
                actions: binding.actions(),
                runAction: (actionId: string) => binding.runAction?.(actionId),
              }
            : {}),
        };
      });
  }

  /** Write a frame reorder back into the group, if every member is visible. */
  #syncOrderFromStore(): void {
    const state = this.store.get();
    for (const entry of this.#groups.values()) {
      const order = entry.group.state.order;
      const records = order.map((viewId) => state.views[viewId]);
      if (records.some((record) => record === undefined || record.hidden === true)) continue;
      const visible = order
        .map((viewId) => [viewId, state.views[viewId]] as const)
        .filter(
          (entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] =>
            entry[1] !== undefined,
        )
        .sort((a, b) => a[1].order - b[1].order)
        .map(([viewId]) => viewId);
      if (visible.some((viewId, index) => viewId !== order[index])) {
        entry.group.reorder(visible);
      }
    }
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
    this.#stop();
  }
}
