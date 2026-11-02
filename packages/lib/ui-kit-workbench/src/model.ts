/**
 * The frame model: the generic placement model from `prac-ui-kit-content` plus
 * the workbench's default topology and window / widget record factory.
 *
 * @module prac-ui-kit-workbench/model
 */

import type { LayoutNode, Sizing, SplitNode } from "prac-ui-kit-layout";
import {
  ensureItem as genericEnsureItem,
  gridNode,
  distributeSplitEvenly as genericDistributeSplitEvenly,
  moveEntry as genericMoveEntry,
  moveItemInRegion as genericMoveItemInRegion,
  normalizeItems as genericNormalizeItems,
  place as genericPlace,
  placeQuietly as genericPlaceQuietly,
  regionNode,
  removeRegion as genericRemoveRegion,
  removeItem as genericRemoveItem,
  resizeBoundary as genericResizeBoundary,
  setCollapsed as genericSetCollapsed,
  setEntryFolded as genericSetEntryFolded,
  setEntryHeight as genericSetEntryHeight,
  setFront as genericSetFront,
  setItemCollapsed as genericSetItemCollapsed,
  setItemSize as genericSetItemSize,
  splitRegionWith as genericSplitRegionWith,
} from "prac-ui-kit-content";
import type { LayoutState } from "./contract.js";
import { BOTTOM_REGION, CENTER_MIN, CENTER_REGION } from "./contract.js";
import type { ItemKind, ItemRecord } from "./contract.js";

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
export function ensureItem(state: LayoutState, itemId: string, kind?: ItemKind): ItemRecord;
export function ensureItem<TRecord extends ItemRecord>(
  state: LayoutState<TRecord>,
  itemId: string,
  create: (itemId: string) => TRecord,
): TRecord;
export function ensureItem<TRecord extends ItemRecord>(
  state: LayoutState<TRecord>,
  itemId: string,
  kindOrCreate: ItemKind | ((itemId: string) => TRecord) = "window",
): TRecord | ItemRecord {
  const ensure = genericEnsureItem as unknown as (
    state: LayoutState,
    itemId: string,
    kindOrCreate?: string | ((id: string) => ItemRecord),
  ) => ItemRecord;
  return ensure(state, itemId, kindOrCreate) as TRecord | ItemRecord;
}

/**
 * Place a window / widget in a region, creating the record with the frame's
 * default kind when the caller did not supply a factory.
 */
export function place<TRecord extends ItemRecord = ItemRecord>(
  state: LayoutState<TRecord>,
  itemId: string,
  regionId: string,
  create?: (itemId: string) => TRecord,
): LayoutState<TRecord> {
  return genericPlace(state, itemId, regionId, create ?? ((id) => frameRecord<TRecord>(state, id)));
}

/** Place without changing the selector's chosen child. */
export function placeQuietly<TRecord extends ItemRecord = ItemRecord>(
  state: LayoutState<TRecord>,
  itemId: string,
  regionId: string,
  create?: (itemId: string) => TRecord,
): LayoutState<TRecord> {
  return genericPlaceQuietly(
    state,
    itemId,
    regionId,
    create ?? ((id) => frameRecord<TRecord>(state, id)),
  );
}

function frameRecord<TRecord extends ItemRecord>(state: LayoutState, itemId: string): TRecord {
  return genericEnsureItem(state, itemId, "window") as TRecord;
}

/**
 * Drop the regions the embedder left behind.
 *
 * A marked region is an editor group's home; an empty one is a leftover that no
 * group can close. Unmarked regions are the app's own shape and are never pruned.
 */
export function pruneEmbedderRegions(state: LayoutState): LayoutState {
  const occupied = new Set(Object.values(state.items).map((view) => view.region));
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
export function moveItemInRegion<TRecord extends ItemRecord>(
  state: LayoutState<TRecord>,
  itemId: string,
  referenceItemId: string,
  direction: "up" | "down",
): LayoutState<TRecord> {
  return genericMoveItemInRegion(state, itemId, referenceItemId, direction) as LayoutState<TRecord>;
}

/** Record-preserving wrappers: the frame's state always carries window / widget records. */
export function removeItem(state: LayoutState, itemId: string): LayoutState {
  return genericRemoveItem(state, itemId) as LayoutState;
}
export function setFront(state: LayoutState, itemId: string): LayoutState {
  return genericSetFront(state, itemId) as LayoutState;
}
export function normalizeItems(state: LayoutState): LayoutState {
  return genericNormalizeItems(state) as LayoutState;
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
export function setItemSize(state: LayoutState, itemId: string, size: number): LayoutState {
  return genericSetItemSize(state, itemId, size) as LayoutState;
}
export function setItemCollapsed(
  state: LayoutState,
  itemId: string,
  collapsed: boolean,
  measuredHeight?: number,
): LayoutState {
  return genericSetItemCollapsed(state, itemId, collapsed, measuredHeight) as LayoutState;
}
