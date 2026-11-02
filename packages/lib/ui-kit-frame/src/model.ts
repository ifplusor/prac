/**
 * The frame model: the generic placement model from `prac-ui-kit-content` plus
 * the workbench's default topology and window / widget record factory.
 *
 * @module prac-ui-kit-frame/model
 */

import type { LayoutNode, Sizing, SplitNode } from "prac-ui-kit-layout";
import {
  ensureView as genericEnsureView,
  gridNode,
  distributeSplitEvenly as genericDistributeSplitEvenly,
  moveEntry as genericMoveEntry,
  moveViewInRegion as genericMoveViewInRegion,
  normalizeViews as genericNormalizeViews,
  place as genericPlace,
  placeQuietly as genericPlaceQuietly,
  regionNode,
  removeRegion as genericRemoveRegion,
  removeView as genericRemoveView,
  resizeBoundary as genericResizeBoundary,
  setCollapsed as genericSetCollapsed,
  setEntryFolded as genericSetEntryFolded,
  setEntryHeight as genericSetEntryHeight,
  setFront as genericSetFront,
  setViewCollapsed as genericSetViewCollapsed,
  setViewSize as genericSetViewSize,
  splitRegionWith as genericSplitRegionWith,
} from "prac-ui-kit-content";
import type { LayoutState } from "./contract.js";
import { BOTTOM_REGION, CENTER_MIN, CENTER_REGION } from "./contract.js";
import type { FrameViewKind, ViewRecord } from "./contract.js";

export * from "prac-ui-kit-content/model";
export {
  STACK_HEADER_HEIGHT,
  activeChild,
  chosenChild,
  edgeRegion,
  entrySashState,
  findParentSplit,
  frontView,
  isPresent,
  showsTabStrip,
  stackEntries,
  visibleViews,
  type EntrySashState,
} from "prac-ui-kit-content";

/** The default frame topology: `left` / stage grid / `right`, with a bottom bar. */
export function defaultTree(): SplitNode {
  return {
    type: "split",
    id: "root",
    dir: "column",
    children: [
      {
        type: "split",
        id: "top",
        dir: "row",
        children: [
          regionNode("left", 280, { stack: true, priority: "low", snap: true }),
          gridNode(
            "stage",
            2,
            2,
            [
              regionNode(CENTER_REGION, 0, {
                flex: true,
                min: CENTER_MIN,
                tabs: "multiple",
                priority: "high",
                snap: true,
              }),
            ],
            { flex: true, min: CENTER_MIN, priority: "high" },
          ),
          regionNode("right", 420, { stack: true, priority: "low", snap: true }),
        ],
      },
      regionNode(BOTTOM_REGION, 240, { stack: true, priority: "low", snap: true }),
    ],
  };
}

/** Ensure a window / widget record exists in a frame state. */
export function ensureView(state: LayoutState, viewId: string, kind?: FrameViewKind): ViewRecord;
export function ensureView<TRecord extends ViewRecord>(
  state: LayoutState<TRecord>,
  viewId: string,
  create: (viewId: string) => TRecord,
): TRecord;
export function ensureView<TRecord extends ViewRecord>(
  state: LayoutState<TRecord>,
  viewId: string,
  kindOrCreate: FrameViewKind | ((viewId: string) => TRecord) = "window",
): TRecord | ViewRecord {
  const ensure = genericEnsureView as unknown as (
    state: LayoutState,
    viewId: string,
    kindOrCreate?: string | ((id: string) => ViewRecord),
  ) => ViewRecord;
  return ensure(state, viewId, kindOrCreate) as TRecord | ViewRecord;
}

/**
 * Place a window / widget in a region, creating the record with the frame's
 * default kind when the caller did not supply a factory.
 */
export function place<TRecord extends ViewRecord = ViewRecord>(
  state: LayoutState<TRecord>,
  viewId: string,
  regionId: string,
  create?: (viewId: string) => TRecord,
): LayoutState<TRecord> {
  return genericPlace(state, viewId, regionId, create ?? ((id) => frameRecord<TRecord>(state, id)));
}

/** Place without changing the selector's chosen child. */
export function placeQuietly<TRecord extends ViewRecord = ViewRecord>(
  state: LayoutState<TRecord>,
  viewId: string,
  regionId: string,
  create?: (viewId: string) => TRecord,
): LayoutState<TRecord> {
  return genericPlaceQuietly(
    state,
    viewId,
    regionId,
    create ?? ((id) => frameRecord<TRecord>(state, id)),
  );
}

function frameRecord<TRecord extends ViewRecord>(state: LayoutState, viewId: string): TRecord {
  return genericEnsureView(state, viewId, "window") as TRecord;
}

/**
 * Drop the regions the embedder left behind.
 *
 * A marked region is an editor group's home; an empty one is a leftover that no
 * group can close. Unmarked regions are the app's own shape and are never pruned.
 */
export function pruneEmbedderRegions(state: LayoutState): LayoutState {
  const occupied = new Set(Object.values(state.views).map((view) => view.region));
  const holdsSomething = (id: string): boolean =>
    occupied.has(id) || [...occupied].some((region) => region.startsWith(`${id}/`));
  const stale: string[] = [];
  const walk = (node: LayoutNode): void => {
    if (node.type === "region") {
      if (node.embedder === true && !holdsSomething(node.id)) stale.push(node.id);
      for (const child of node.children ?? []) walk(child);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(state.tree);
  let next = state;
  for (const id of stale.reverse()) next = genericRemoveRegion(next, id) as LayoutState;
  return next;
}

/** Record-preserving aliases over the generic content model. */
export function moveViewInRegion<TRecord extends ViewRecord>(
  state: LayoutState<TRecord>,
  viewId: string,
  referenceViewId: string,
  direction: "up" | "down",
): LayoutState<TRecord> {
  return genericMoveViewInRegion(state, viewId, referenceViewId, direction) as LayoutState<TRecord>;
}

/** Record-preserving wrappers: the frame's state always carries window / widget records. */
export function removeView(state: LayoutState, viewId: string): LayoutState {
  return genericRemoveView(state, viewId) as LayoutState;
}
export function setFront(state: LayoutState, viewId: string): LayoutState {
  return genericSetFront(state, viewId) as LayoutState;
}
export function normalizeViews(state: LayoutState): LayoutState {
  return genericNormalizeViews(state) as LayoutState;
}
export function resizeBoundary(
  state: LayoutState,
  splitId: string,
  index: number,
  delta: number,
  sizing: Sizing = "distribute",
  current?: ReadonlyMap<string, number>,
): LayoutState {
  return genericResizeBoundary(state, splitId, index, delta, sizing, current) as LayoutState;
}
export function distributeSplitEvenly(
  state: LayoutState,
  splitId: string,
  drawn?: ReadonlyMap<string, number>,
): LayoutState {
  return genericDistributeSplitEvenly(state, splitId, drawn) as LayoutState;
}
export function setCollapsed(
  state: LayoutState,
  regionId: string,
  collapsed: boolean,
  remember?: number,
): LayoutState {
  return genericSetCollapsed(state, regionId, collapsed, remember) as LayoutState;
}
export function splitRegionWith(
  state: LayoutState,
  regionId: string,
  side: "left" | "right" | "up" | "down",
  splitId: string,
  newRegionId: string,
  options?: { embedder?: boolean; gridCells?: boolean },
): LayoutState {
  return genericSplitRegionWith(
    state,
    regionId,
    side,
    splitId,
    newRegionId,
    options,
  ) as LayoutState;
}
export function removeRegion(state: LayoutState, regionId: string): LayoutState {
  return genericRemoveRegion(state, regionId) as LayoutState;
}
export function setEntryHeight(state: LayoutState, entryId: string, height: number): LayoutState {
  return genericSetEntryHeight(state, entryId, height) as LayoutState;
}
export function setEntryFolded(
  state: LayoutState,
  entryId: string,
  collapsed: boolean,
  measuredHeight?: number,
): LayoutState {
  return genericSetEntryFolded(state, entryId, collapsed, measuredHeight) as LayoutState;
}
export function moveEntry(
  state: LayoutState,
  entryId: string,
  referenceId: string,
  direction: "up" | "down",
): LayoutState {
  return genericMoveEntry(state, entryId, referenceId, direction) as LayoutState;
}
export function setViewSize(state: LayoutState, viewId: string, size: number): LayoutState {
  return genericSetViewSize(state, viewId, size) as LayoutState;
}
export function setViewCollapsed(
  state: LayoutState,
  viewId: string,
  collapsed: boolean,
  measuredHeight?: number,
): LayoutState {
  return genericSetViewCollapsed(state, viewId, collapsed, measuredHeight) as LayoutState;
}
