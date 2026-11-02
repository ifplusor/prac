/**
 * The frame's owner of view groups.
 *
 * One view-group id maps to one frame region. The host owns the bridge that
 * projects the group into the layout store; it does not own the group runtime
 * (the resource materializer does) and it does not create regions (the
 * arrangement does).
 *
 * @module prac-ui-kit-workbench/regionBindings
 */

import { findNode } from "prac-ui-kit-layout";
import type {
  WindowGroup,
  WindowGroupAction as GroupAction,
  WindowGroupActionBinding as GroupActionBinding,
} from "./workbenchModel.js";
import type { LayoutStore } from "./store.js";
import { WindowGroupLayoutBridge } from "./groupBridge.js";
import type { GroupRegionContent } from "./regionContent.js";

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
export interface RegionBinding {
  /** The region content registered for this region. */
  readonly content: GroupRegionContent<WindowGroup>;
  /** Convenience view of `content.group`. */
  readonly group: WindowGroup;
  readonly regionId: string;
  readonly bridge: WindowGroupLayoutBridge;
}

/** Owns the group → region bindings for one frame store. */
export class WindowGroupBindings {
  readonly #groups = new Map<string, RegionBinding>();
  readonly #regions = new Map<string, string>();
  readonly #stop: () => void;

  constructor(private readonly store: LayoutStore) {
    this.#stop = store.subscribe(() => this.#syncOrderFromStore());
  }

  /** Register a group in an existing region. */
  register(
    group: WindowGroup,
    regionId: string,
    content?: GroupRegionContent<WindowGroup>,
  ): RegionBinding {
    if (this.#groups.has(group.id)) throw new Error(`view group already registered: ${group.id}`);
    if (this.#regions.has(regionId)) {
      throw new Error(`region already hosts a view group: ${regionId}`);
    }
    const node = findNode(this.store.get().tree, regionId);
    if (node === null || (node.type !== "region" && content?.kind !== "widget-board")) {
      throw new Error(`unknown region: ${regionId}`);
    }
    const bridge = new WindowGroupLayoutBridge(group, this.store, regionId);
    const owningContent: GroupRegionContent<WindowGroup> = content ?? {
      kind: group.state.mode === "select" ? "window-group" : "widget-board",
      group,
      dispose: () => group.dispose(),
    };
    const frameGroup: RegionBinding = {
      content: owningContent,
      get group() {
        return owningContent.group;
      },
      regionId,
      bridge,
    };
    this.#groups.set(group.id, frameGroup);
    this.#regions.set(regionId, group.id);
    return frameGroup;
  }

  /** Register a region content's group in a region. */
  registerContent(content: GroupRegionContent<WindowGroup>, regionId: string): RegionBinding {
    return this.register(content.group, regionId, content);
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
      const records = order.map((itemId) => state.items[itemId]);
      if (records.some((record) => record === undefined || record.hidden === true)) continue;
      const visible = order
        .map((itemId) => [itemId, state.items[itemId]] as const)
        .filter(
          (entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] =>
            entry[1] !== undefined,
        )
        .sort((a, b) => a[1].order - b[1].order)
        .map(([itemId]) => itemId);
      if (visible.some((itemId, index) => itemId !== order[index])) {
        entry.group.reorder(visible);
      }
    }
  }

  /** The region content registered for a region, if any. */
  contentFor(regionId: string): GroupRegionContent<WindowGroup> | undefined {
    return [...this.#groups.values()].find(
      (entry) => entry.regionId === regionId || entry.regionId.startsWith(`${regionId}/`),
    )?.content;
  }

  /** Look up a registered group. */
  get(groupId: string): RegionBinding | undefined {
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
