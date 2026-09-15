/**
 * The layout model: pure functions over the region tree and the views table.
 *
 * Nothing here touches React or the DOM — placement is data, so `place`,
 * `setCollapsed` and `splitRegion` are ordinary tree rewrites that the store
 * commits and the frame renders.
 *
 * @module prac-client-ui-layout/client/model
 */

import type { RegionInfo } from "./catalogue.js";
import {
  CENTER_MIN,
  DEFAULT_MIN,
  SASH_SIZE,
  type Box,
  type Dir,
  type LayoutNode,
  type LayoutState,
  type RegionNode,
  type SplitNode,
  type ViewRecord,
} from "./contract.js";

/**
 * Build a fixed region.
 *
 * @param id - region id.
 * @param size - initial size along the parent split's axis.
 * @param extra - overrides (`flex`, `min`, …).
 */
export function regionNode(id: string, size: number, extra: Partial<RegionNode> = {}): RegionNode {
  return {
    type: "region",
    id,
    size,
    flex: false,
    collapsed: false,
    cachedSize: size,
    min: DEFAULT_MIN,
    ...extra,
  };
}

/**
 * The default region tree: the frame's topology, expressed as a tree.
 *
 * A row of three regions — `left` (280), `console` (flexible), `right` (420).
 * This is *topology*, not placement: which view occupies which region is the
 * arrangement's decision, and no region knows what may go in it.
 */
export function defaultTree(): SplitNode {
  return {
    type: "split",
    id: "root",
    dir: "row",
    children: [
      regionNode("left", 280),
      regionNode("stage", 0, { flex: true, min: CENTER_MIN }),
      regionNode("right", 420),
    ],
  };
}

// ── tree helpers (all pure) ───────────────────────────────────────────

/**
 * Depth-first region lookup.
 *
 * @param node - subtree root.
 * @param id - region id to find.
 * @returns the region node, or null.
 */
export function findRegion(node: LayoutNode, id: string): RegionNode | null {
  if (node.type === "region") return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findRegion(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Depth-first split lookup.
 *
 * @param node - subtree root.
 * @param id - split id to find.
 * @returns the split node, or null.
 */
export function findSplit(node: LayoutNode, id: string): SplitNode | null {
  if (node.type !== "split") return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSplit(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * The first region id in tree order: the mechanism's generic home for a view
 * nothing has placed yet (never a per-view default).
 *
 * @param node - subtree root.
 * @returns the first region id.
 */
export function firstRegionId(node: LayoutNode): string {
  return node.type === "region" ? node.id : firstRegionId(node.children[0]);
}

/**
 * Every region in the subtree, in tree order (left-to-right, top-to-bottom).
 *
 * @param node - subtree root.
 * @returns one entry per region, in tree order.
 */
export function regionInfos(node: LayoutNode): RegionInfo[] {
  if (node.type === "region") return [{ id: node.id, collapsed: node.collapsed }];
  return node.children.flatMap((child) => regionInfos(child));
}

/**
 * Return a new tree with the node whose id matches replaced.
 *
 * @param node - subtree root.
 * @param id - node id to replace.
 * @param replacer - produces the replacement node.
 */
export function replaceNode(
  node: LayoutNode,
  id: string,
  replacer: (node: LayoutNode) => LayoutNode,
): LayoutNode {
  if (node.id === id) return replacer(node);
  if (node.type !== "split") return node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = replaceNode(child, id, replacer);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Return a new tree with one region's record replaced by `updater`.
 *
 * @param tree - the tree to update.
 * @param id - region id.
 * @param updater - pure region updater.
 */
export function updateRegion(
  tree: LayoutNode,
  id: string,
  updater: (node: RegionNode) => RegionNode,
): LayoutNode {
  return replaceNode(tree, id, (node) => (node.type === "region" ? updater(node) : node));
}

/**
 * Return a new tree with one region's fixed size changed.
 *
 * @param tree - the tree to update.
 * @param id - region id.
 * @param size - requested size in px (rounded, clamped at 0).
 */
export function setRegionSize(tree: LayoutNode, id: string, size: number): LayoutNode {
  return updateRegion(tree, id, (node) => ({ ...node, size: Math.max(0, Math.round(size)) }));
}

/**
 * The size a node contributes to its parent split along the split's axis.
 *
 * @param node - the child node.
 */
export function nodeBasis(node: LayoutNode): { flex: boolean; size: number } {
  if (node.type === "split") return { flex: true, size: 0 };
  if (node.collapsed) return { flex: false, size: 0 };
  return { flex: node.flex, size: node.size };
}

// ── placement & visibility ────────────────────────────────────────────

/**
 * Ensure a view exists in the state, then return its record.
 *
 * An unplaced view gets the tree's first region and stays hidden until
 * something places or shows it — a generic fallback, never a per-view default.
 *
 * @param state - current state.
 * @param viewId - the view identity.
 */
export function ensureView(state: LayoutState, viewId: string): ViewRecord {
  const existing: ViewRecord | undefined = state.views[viewId];
  return existing ?? { region: firstRegionId(state.tree), order: 0, hidden: true };
}

/**
 * Place a view in a region (creating the view record if needed).
 *
 * The placed view takes the front of its region: `place` is "show it here",
 * and a region renders the front of its visible list.
 *
 * @param state - current state.
 * @param viewId - the view identity.
 * @param regionId - the destination region.
 */
export function place(state: LayoutState, viewId: string, regionId: string): LayoutState {
  const view = ensureView(state, viewId);
  const front = Math.min(0, ...Object.values(state.views).map((entry) => entry.order)) - 1;
  return {
    ...state,
    views: { ...state.views, [viewId]: { ...view, region: regionId, hidden: false, order: front } },
  };
}

/**
 * The region's visible views, in order. The first one renders.
 *
 * @param state - current state.
 * @param regionId - the region to inspect.
 */
export function visibleViews(state: LayoutState, regionId: string): string[] {
  return Object.entries(state.views)
    .filter(([, view]) => view.region === regionId && !view.hidden)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
}

/**
 * Whether a region takes part in the layout at all.
 *
 * A collapsed region stays *present* (it renders at 0px, so a collapse is
 * visible in the DOM), and a flexible region always is — the centre work area
 * exists even when empty. A fixed region with nothing visible to show does
 * not: that is what lets attention close a track by moving its only view
 * away (promoting the VS Code part out of `right` collapses the track).
 *
 * @param state - current state.
 * @param node - the subtree to test.
 */
export function isPresent(state: LayoutState, node: LayoutNode): boolean {
  if (node.type === "split") return node.children.some((child) => isPresent(state, child));
  if (node.collapsed) return true;
  return node.flex || visibleViews(state, node.id).length > 0;
}

/**
 * The nearest present region on one `side` of a subtree.
 *
 * @param state - current state.
 * @param node - the subtree to descend.
 * @param side - which edge to take.
 * @returns the edge region, or null when nothing in the subtree is present.
 */
export function edgeRegion(
  state: LayoutState,
  node: LayoutNode,
  side: "left" | "right",
): RegionNode | null {
  if (node.type === "region") return node;
  const present = node.children.filter((child) => isPresent(state, child));
  if (present.length === 0) return null;
  return edgeRegion(state, side === "left" ? present[0] : present[present.length - 1], side);
}

/**
 * Resolve every region's pixel box for a given viewport.
 *
 * Flexbox does the real layout; this is the same distribution done in
 * arithmetic so owner props (`sidebar.width`, `rightbar.width`) can be told
 * what their occupant has, without a DOM read.
 *
 * @param state - current state.
 * @param width - frame width in px.
 * @param height - frame height in px.
 */
export function resolveSizes(state: LayoutState, width: number, height: number): Map<string, Box> {
  const out = new Map<string, Box>();
  const visit = (node: LayoutNode, w: number, h: number): void => {
    if (node.type === "region") {
      out.set(node.id, { width: w, height: h });
      return;
    }
    const present = node.children.filter((child) => isPresent(state, child));
    const extent = node.dir === "row" ? w : h;
    const sashes = Math.max(0, present.length - 1) * SASH_SIZE;
    const content = Math.max(0, extent - sashes);
    const basis = present.map(nodeBasis);
    const fixedTotal = basis.reduce((total, entry) => total + (entry.flex ? 0 : entry.size), 0);
    const flexCount = basis.filter((entry) => entry.flex).length;
    const share = flexCount > 0 ? Math.max(0, content - fixedTotal) / flexCount : 0;
    present.forEach((child, index) => {
      const main = basis[index].flex ? share : basis[index].size;
      if (node.dir === "row") visit(child, main, h);
      else visit(child, w, main);
    });
  };
  visit(state.tree, width, height);
  return out;
}

// ── collapse & split ──────────────────────────────────────────────────

/**
 * Collapse or expand a region.
 *
 * Collapsing stores the current size in `cachedSize` and drops the size to
 * 0; expanding restores `cachedSize`. This is the `cachedVisibleSize`
 * behaviour borrowed from VS Code's grid — the width is remembered, not
 * re-guessed.
 *
 * @param state - current state.
 * @param regionId - the region to collapse or expand.
 * @param collapsed - the requested state.
 */
export function setCollapsed(
  state: LayoutState,
  regionId: string,
  collapsed: boolean,
): LayoutState {
  const node = findRegion(state.tree, regionId);
  if (!node || node.collapsed === collapsed) return state;
  const tree = updateRegion(state.tree, regionId, (target) =>
    collapsed
      ? {
          ...target,
          collapsed: true,
          cachedSize: target.size > 0 ? target.size : target.cachedSize,
          size: 0,
        }
      : {
          ...target,
          collapsed: false,
          size: target.cachedSize > 0 ? target.cachedSize : target.size,
        },
  );
  return { ...state, tree };
}

/**
 * Replace a region with a split of the original region and a new, empty one.
 *
 * The new region is flexible: splitting a work area hands you another work
 * area, and a flexible region is present even while empty (see `isPresent`),
 * so the split is visible immediately.
 *
 * @param state - current state.
 * @param regionId - the region to split.
 * @param dir - the new split's axis.
 * @param splitId - id for the replacement split.
 * @param newRegionId - id for the new empty region.
 */
export function splitRegion(
  state: LayoutState,
  regionId: string,
  dir: Dir,
  splitId: string,
  newRegionId: string,
): LayoutState {
  const node = findRegion(state.tree, regionId);
  if (!node) return state;
  const replacement: SplitNode = {
    type: "split",
    id: splitId,
    dir,
    children: [node, regionNode(newRegionId, 360, { flex: true, min: DEFAULT_MIN })],
  };
  return { ...state, tree: replaceNode(state.tree, regionId, () => replacement) };
}
