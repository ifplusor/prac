/**
 * The renderer's read-only model helpers.
 *
 * These are the parts of the frame model the geometry renderer needs; they are
 * generic over `PlacementRecord`, so a frame root and a board root can share
 * the same renderer.
 *
 * @module prac-ui-kit-content/renderModel
 */

import type { Box, LayoutNode, RegionNode, SplitNode } from "prac-ui-kit-layout";
import { findSplit, nodeBasis } from "prac-ui-kit-layout";
import type { LayoutState, PlacementRecord } from "./placement.js";

/** Width/height of a sash hit area, in px. */
export const SASH_SIZE = 4;

/** Height of a folded stack row's header. */
export const STACK_HEADER_HEIGHT = 22;

/** A box standing in for a region the resolver has not measured yet. */
export const ZERO_BOX: Box = { width: 0, height: 0 };

/** Inline style values the renderer emits. */
export type StyleObject = Record<string, string | number>;

/** The four states VS Code gives a sash. */
export type EntrySashState = "enabled" | "at-minimum" | "at-maximum" | "disabled";

/** The child a selector region records as its choice. */
export function chosenChild(state: LayoutState, node: RegionNode): LayoutNode | null {
  const children = node.children;
  if (children === undefined || node.active === undefined) return null;
  return children.find((child) => child.id === node.active) ?? null;
}

/** The child a selector region should actually show. */
export function activeChild(state: LayoutState, node: RegionNode): LayoutNode | null {
  const children = node.children;
  if (children === undefined || children.length === 0) return null;
  const chosen = children.find((child) => child.id === node.active);
  if (chosen !== undefined && isPresent(state, chosen)) return chosen;
  return children.find((child) => isPresent(state, child)) ?? null;
}

/** The region's visible items, in order. */
export function visibleItems<TRecord extends PlacementRecord>(
  state: LayoutState<TRecord>,
  regionId: string,
): string[] {
  const split = state.tree === undefined ? null : findSplit(state.tree, regionId);
  const inRows = new Set(split === null ? [] : stackEntries(split).map((entry) => entry.id));
  return Object.entries(state.items)
    .filter(([, view]) => !view.hidden && (view.region === regionId || inRows.has(view.region)))
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
}

/** The item a region currently shows. */
export function frontItem<TRecord extends PlacementRecord>(
  state: LayoutState<TRecord>,
  regionId: string,
): string | undefined {
  const items = visibleItems(state, regionId);
  return items.find((id) => state.items[id]?.front === true) ?? items[0];
}

/** Whether a region takes part in the layout at all. */
export function isPresent(state: LayoutState, node: LayoutNode): boolean {
  if (node.type === "grid" || node.type === "split") {
    return node.children.some((child) => isPresent(state, child));
  }
  if (node.entry === true) return visibleItems(state, node.id).length > 0;
  if (node.collapsed) return true;
  const children = node.children;
  if (children !== undefined && children.length > 0) {
    return node.flex || children.some((child) => isPresent(state, child));
  }
  return node.flex || visibleItems(state, node.id).length > 0;
}

/** Whether a region renders a tab strip. */
export function showsTabStrip(state: LayoutState, node: LayoutNode): boolean {
  if (node.type !== "region") return false;
  const count = visibleItems(state, node.id).length;
  if (node.tabs === "multiple") return count >= 1;
  if (node.tabs === "single") return count > 1;
  return false;
}

/** The nearest present region on one side of a subtree. */
export function edgeRegion(
  state: LayoutState,
  node: LayoutNode,
  side: "left" | "right",
): RegionNode | null {
  if (node.type === "region") return node;
  const present = node.children.filter((child) => isPresent(state, child));
  if (present.length === 0) return null;
  return edgeRegion(state, side === "left" ? present[0]! : present[present.length - 1]!, side);
}

/** The split that directly owns `id`, if any. */
export function findParentSplit(node: LayoutNode, id: string): SplitNode | null {
  const children = node.children ?? [];
  if (node.type === "split" && children.some((child) => child.id === id)) return node;
  for (const child of children) {
    const hit = findParentSplit(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** The rows of a stack split, or an empty list when it is not a stack. */
export function stackEntries(node: LayoutNode): RegionNode[] {
  if (node.type !== "split" || node.dir !== "column") return [];
  const entries = node.children.filter(
    (child): child is RegionNode => child.type === "region" && child.entry === true,
  );
  return entries.length === node.children.length ? entries : [];
}

/** The sash state of the boundary under a stack row. */
export function entrySashState(
  state: LayoutState,
  rowId: string,
  drawn?: ReadonlyMap<string, number>,
): EntrySashState {
  const parent = findParentSplit(state.tree, rowId);
  const siblings = parent === null ? [] : stackEntries(parent);
  const at = siblings.findIndex((row) => row.id === rowId);
  if (at < 0 || at >= siblings.length - 1) return "disabled";
  const sizeOf = (row: RegionNode): number => drawn?.get(row.id) ?? nodeBasis(row).size;
  const canShrink = (rows: readonly RegionNode[]): boolean =>
    rows.some((row) => row.collapsed !== true && sizeOf(row) - nodeBasis(row).min > 0);
  const canGrow = (rows: readonly RegionNode[]): boolean =>
    rows.some((row) => row.collapsed !== true && nodeBasis(row).max - sizeOf(row) > 0);
  const up = siblings.slice(0, at + 1);
  const down = siblings.slice(at + 1);
  const downOk = canGrow(up) && canShrink(down);
  const upOk = canShrink(up) && canGrow(down);
  if (!upOk && !downOk) return "disabled";
  if (upOk && downOk) return "enabled";
  return downOk ? "at-minimum" : "at-maximum";
}
