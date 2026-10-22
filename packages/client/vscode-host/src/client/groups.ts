/**
 * The VS Code group host.
 *
 * It materializes `VscodeViewGroup` resources, attaches their source binding,
 * and registers the runtime with the frame's group face. Placement remains the
 * frame's: the host receives the region id, it does not invent one.
 *
 * @module prac-client-vscode-host/client/groups
 */

import type { FrameViewGroup } from "prac-client-ui-layout/client";
import type { VscodeCatalogueEntry } from "./public.js";
import type { VscodeGroupRuntime } from "./resources.js";
import {
  VSCODE_API_VERSION,
  type VscodeViewGroup,
  type VscodeViewGroupDefinition,
} from "./resources.js";

/** The frame operations the group host needs. */
export interface VscodeGroupLayout {
  registerViewGroup(group: FrameViewGroup, regionId: string): unknown;
  unregisterViewGroup(groupId: string): void;
}

/** Inputs for the VS Code group host. */
export interface VscodeGroupHostOptions {
  readonly layout: VscodeGroupLayout;
  readonly definition: VscodeViewGroupDefinition;
}

/** Materializes and registers VS Code view groups. */
export class VscodeGroupHost {
  readonly #groups = new Map<string, { group: VscodeGroupRuntime; regionId: string }>();

  constructor(private readonly options: VscodeGroupHostOptions) {}

  /** Materialize a group, attach its binding, and register it in a frame region. */
  add(resource: VscodeViewGroup, regionId: string): VscodeGroupRuntime {
    if (this.#groups.has(resource.metadata.id)) {
      throw new Error(`view group already hosted: ${resource.metadata.id}`);
    }
    const group = this.options.definition.materialize(resource) as unknown as VscodeGroupRuntime;
    const binding = this.options.definition.bindingFactory?.(resource);
    if (binding !== undefined) group.setBinding(binding);
    try {
      this.options.layout.registerViewGroup(group, regionId);
    } catch (cause) {
      group.dispose();
      throw cause;
    }
    this.#groups.set(resource.metadata.id, { group, regionId });
    return group;
  }

  /** Whether this host owns a group id. */
  has(groupId: string): boolean {
    return this.#groups.has(groupId);
  }

  /** The group ids currently hosted. */
  ids(): readonly string[] {
    return [...this.#groups.keys()];
  }

  /** Remove one hosted group; its runtime is disposed by the host. */
  remove(groupId: string): void {
    const entry = this.#groups.get(groupId);
    if (!entry) return;
    this.#groups.delete(groupId);
    this.options.layout.unregisterViewGroup(groupId);
    entry.group.dispose();
  }

  /** Remove every hosted group. */
  dispose(): void {
    for (const groupId of this.#groups.keys()) this.remove(groupId);
  }
}

/** One group resource per catalogue container, stable by container id. */
export function viewGroupsFromCatalogue(
  entries: readonly { readonly containerId?: string; readonly containerTitle?: string }[],
): VscodeViewGroup[] {
  const byContainer = new Map<string, { title?: string }>();
  for (const entry of entries) {
    if (entry.containerId === undefined) continue;
    byContainer.set(entry.containerId, { title: entry.containerTitle });
  }
  return [...byContainer].map(([containerId, { title }]) => ({
    apiVersion: VSCODE_API_VERSION,
    kind: "ViewGroup",
    metadata: { id: `vscode:group:${containerId}` },
    spec: {
      groupKind: "container",
      containerId,
      ...(title === undefined ? {} : { title }),
    },
  }));
}

/** The frame region a catalogue location defaults to. */
/** One planned group resource and its default region. */
export interface PlannedVscodeGroup {
  readonly resource: VscodeViewGroup;
  readonly regionId: string;
}

/**
 * Plan group resources from a catalogue and the frame's current regions.
 *
 * A group's default region comes from the catalogue's location hint. When that
 * region does not exist, the first available region is used; with no regions at
 * all the group is omitted (registration would fail).
 */
export function planViewGroups(
  entries: readonly VscodeCatalogueEntry[],
  regionIds: readonly string[],
): readonly PlannedVscodeGroup[] {
  const planned: PlannedVscodeGroup[] = [];
  for (const resource of viewGroupsFromCatalogue(entries)) {
    const entry = entries.find((candidate) => candidate.containerId === resource.spec.containerId);
    const desired = entry === undefined ? undefined : regionForLocation(entry.location);
    const regionId = desired !== undefined && regionIds.includes(desired) ? desired : regionIds[0];
    if (regionId !== undefined) planned.push({ resource, regionId });
  }
  return planned;
}

export function regionForLocation(
  location: "stage" | "sidebar" | "panel" | "auxiliarybar",
): string {
  switch (location) {
    case "stage":
      return "center";
    case "panel":
      return "bottom";
    case "auxiliarybar":
      return "right";
    case "sidebar":
    default:
      return "left";
  }
}
