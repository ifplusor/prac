/**
 * The VS Code group host.
 *
 * It materializes `VscodeViewGroup` resources, attaches their source binding,
 * and registers the runtime with the frame's group face. Placement remains the
 * frame's: the host receives the region id, it does not invent one.
 *
 * @module prac-client-vscode-host/client/groups
 */

import type { FrameView, FrameViewGroup } from "prac-client-ui-layout/client";
import type { VscodeCatalogueEntry } from "./public.js";
import type { VscodeGroupRuntime } from "./resources.js";
import {
  VSCODE_API_VERSION,
  type VscodeView,
  type VscodeViewDefinition,
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
  readonly viewDefinition: VscodeViewDefinition;
}

/** Materializes and registers VS Code view groups. */
export class VscodeGroupHost {
  readonly #groups = new Map<string, { group: VscodeGroupRuntime; regionId: string }>();
  readonly #views = new Map<string, { group: VscodeGroupRuntime; view: FrameView }>();

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

  /** The frame region a hosted group currently occupies. */
  regionOf(groupId: string): string | undefined {
    return this.#groups.get(groupId)?.regionId;
  }

  /** Reconcile groups and container views against a catalogue and region set. */
  sync(entries: readonly VscodeCatalogueEntry[], regionIds: readonly string[]): void {
    const planned = planViewGroups(entries, regionIds);
    const wantedGroups = new Set(planned.map((item) => item.resource.metadata.id));
    for (const groupId of this.ids()) {
      if (!wantedGroups.has(groupId)) this.remove(groupId);
    }
    for (const item of planned) {
      const groupId = item.resource.metadata.id;
      if (this.has(groupId) && this.regionOf(groupId) !== item.regionId) {
        this.remove(groupId);
      }
      if (!this.has(groupId)) this.add(item.resource, item.regionId);
    }

    const wantedViews = new Set(
      entries
        .map((entry) => (viewGroupIdFor(entry) === undefined ? undefined : entry.view))
        .filter((view): view is string => view !== undefined),
    );
    for (const viewId of this.viewIds()) {
      if (!wantedViews.has(viewId)) this.removeView(viewId);
    }
    for (const entry of entries) {
      const groupId = viewGroupIdFor(entry);
      if (groupId === undefined) continue;
      if (this.has(groupId) && !this.hasView(entry.view)) {
        this.addView(groupId, viewFromCatalogue(entry));
      }
    }
  }

  /** Whether this host owns a group id. */
  has(groupId: string): boolean {
    return this.#groups.has(groupId);
  }

  /** The group ids currently hosted. */
  ids(): readonly string[] {
    return [...this.#groups.keys()];
  }

  /** Materialize a view and add it to a hosted group. */
  addView(groupId: string, resource: VscodeView): FrameView {
    const entry = this.#groups.get(groupId);
    if (!entry) throw new Error(`view group is not hosted: ${groupId}`);
    if (this.#views.has(resource.metadata.id)) {
      throw new Error(`view already hosted: ${resource.metadata.id}`);
    }
    const view = this.options.viewDefinition.materialize(resource) as unknown as FrameView;
    entry.group.add(view);
    this.#views.set(resource.metadata.id, { group: entry.group, view });
    return view;
  }

  /** Select a view in a hosted group when it belongs to that group. */
  select(groupId: string, viewId: string): void {
    const group = this.#groups.get(groupId);
    const view = this.#views.get(viewId);
    if (!group || !view || view.group !== group.group) return;
    group.group.select(viewId);
  }

  /** Remove one hosted view from its group. */
  removeView(viewId: string): void {
    const entry = this.#views.get(viewId);
    if (!entry) return;
    this.#views.delete(viewId);
    entry.group.remove(viewId);
  }

  /** The view ids currently hosted. */
  viewIds(): readonly string[] {
    return [...this.#views.keys()];
  }

  /** Whether this host owns a view id. */
  hasView(viewId: string): boolean {
    return this.#views.has(viewId);
  }

  /** Remove one hosted group; its runtime is disposed by the host. */
  remove(groupId: string): void {
    const entry = this.#groups.get(groupId);
    if (!entry) return;
    this.#groups.delete(groupId);
    for (const [viewId, view] of this.#views) {
      if (view.group === entry.group) this.#views.delete(viewId);
    }
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
  entries: readonly {
    readonly containerId?: string;
    readonly containerTitle?: string;
    readonly source?: "file" | "view";
  }[],
): VscodeViewGroup[] {
  const byContainer = new Map<string, { title?: string }>();
  let hasFiles = false;
  for (const entry of entries) {
    if (entry.source === "file") hasFiles = true;
    if (entry.containerId === undefined) continue;
    byContainer.set(entry.containerId, { title: entry.containerTitle });
  }
  const groups: VscodeViewGroup[] = [...byContainer].map(([containerId, { title }]) => ({
    apiVersion: VSCODE_API_VERSION,
    kind: "ViewGroup",
    metadata: { id: `vscode:group:${containerId}` },
    spec: {
      groupKind: "container",
      containerId,
      ...(title === undefined ? {} : { title }),
    },
  }));
  if (hasFiles) {
    groups.push({
      apiVersion: VSCODE_API_VERSION,
      kind: "ViewGroup",
      metadata: { id: EDITOR_GROUP_ID },
      spec: { groupKind: "editor", title: "Editor" },
    });
  }
  return groups;
}

/** The one editor group the initial slice hosts. */
export const EDITOR_GROUP_ID = "vscode:group:editor";

/** The group a catalogue entry belongs to, or undefined when it has no home yet. */
export function viewGroupIdFor(entry: VscodeCatalogueEntry): string | undefined {
  if (entry.containerId !== undefined) return `vscode:group:${entry.containerId}`;
  return entry.source === "file" ? EDITOR_GROUP_ID : undefined;
}

/** The frame region a catalogue location defaults to. */
/** Build a view resource from one catalogue entry. */
export function viewFromCatalogue(entry: VscodeCatalogueEntry): VscodeView {
  return {
    apiVersion: VSCODE_API_VERSION,
    kind: "View",
    metadata: { id: entry.view },
    spec: {
      hostKind: entry.source === "file" ? "editor-pane" : "view-pane",
      viewId: entry.appId,
      title: entry.title,
      ...(entry.containerId === undefined ? {} : { containerId: entry.containerId }),
    },
  };
}

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
    const desired =
      resource.spec.groupKind === "editor"
        ? "center"
        : entry === undefined
          ? undefined
          : regionForLocation(entry.location);
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
