/**
 * The layout model: pure functions over the region tree and the views table.
 *
 * Nothing here touches React or the DOM — placement is data, so `place`,
 * `setCollapsed` and `splitRegionWith` are ordinary tree rewrites that the store
 * commits and the frame renders.
 *
 * @module prac-client-ui-layout/client/model
 */

import type { RegionInfo } from "./catalogue.js";
import {
  BOTTOM_REGION,
  CENTER_MIN,
  CENTER_REGION,
  DEFAULT_MIN,
  SASH_SIZE,
  type Box,
  type Dir,
  type LayoutNode,
  type LayoutState,
  type RegionNode,
  type Side,
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
 * A node's children, whichever kind it is.
 *
 * A split lays out its children; a region's children are the sub-regions it
 * **selects** among (empty when it holds views directly).
 *
 * @param node - the node.
 */
function childNodes(node: LayoutNode): readonly LayoutNode[] {
  return node.type === "split" ? node.children : (node.children ?? []);
}

/**
 * The child region a selector region shows.
 *
 * The recorded choice wins while it is still present; otherwise the first
 * present child. `null` means the region has no children — it holds views.
 *
 * @param state - current state.
 * @param node - the region to look into.
 */
export function activeChild(state: LayoutState, node: RegionNode): RegionNode | null {
  const children = node.children;
  if (children === undefined || children.length === 0) return null;
  const chosen = children.find((child) => child.id === node.active);
  if (chosen !== undefined && isPresent(state, chosen)) return chosen;
  return children.find((child) => isPresent(state, child)) ?? null;
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
    dir: "column",
    children: [
      {
        type: "split",
        id: "top",
        dir: "row",
        children: [
          regionNode("left", 280, { stack: true }),
          // The centre is the editor group of this layout: it gets the tab strip
          // (VS Code's default `showTabs: "multiple"`), and it stays flexible so an
          // empty work area is still present.
          regionNode(CENTER_REGION, 0, { flex: true, min: CENTER_MIN, tabs: "multiple" }),
          regionNode("right", 420, { stack: true }),
        ],
      },
      // Empty at boot: an empty region is not rendered, so this costs the default
      // layout nothing and appears (at its size) as soon as something lands in it.
      regionNode(BOTTOM_REGION, 240, { stack: true }),
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
  if (node.type === "region" && node.id === id) return node;
  for (const child of childNodes(node)) {
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
  const children = childNodes(node);
  if (node.type === "region" && children.length === 0) return node.id;
  return firstRegionId(children[0]);
}

/**
 * Every region in the subtree, in tree order (left-to-right, top-to-bottom).
 *
 * @param node - subtree root.
 * @returns one entry per region, in tree order.
 */
export function regionInfos(node: LayoutNode): RegionInfo[] {
  if (node.type === "split") return node.children.flatMap((child) => regionInfos(child));
  return [
    { id: node.id, collapsed: node.collapsed },
    ...(node.children ?? []).flatMap((child) => regionInfos(child)),
  ];
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
  if (node.type === "region" && node.children === undefined) return node;
  let changed = false;
  const children = childNodes(node).map((child) => {
    const next = replaceNode(child, id, replacer);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return node;
  return node.type === "split"
    ? { ...node, children }
    : { ...node, children: children as readonly RegionNode[] };
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
 * Give a region its sub-regions, and optionally a name.
 *
 * This is how the arrangement builds a **container**: a child region, named from
 * the source catalogue, with the container's views placed into it. Idempotent —
 * rebuilding after a catalogue change replaces the children wholesale, which is
 * what "the catalogue is the truth" means here.
 *
 * @param tree - the tree to update.
 * @param id - the selector region.
 * @param children - the child regions, in bar order.
 * @param label - an optional display name for the selector itself.
 */
export function setRegionChildren(
  tree: LayoutNode,
  id: string,
  children: readonly RegionNode[],
  label?: string,
): LayoutNode {
  return updateRegion(tree, id, (node) => ({
    ...node,
    children,
    ...(label === undefined ? {} : { label }),
  }));
}

/**
 * Bring one child of a selector region to the front.
 *
 * @param tree - the tree to update.
 * @param regionId - the selector region.
 * @param childId - the child to show.
 */
export function selectChild(tree: LayoutNode, regionId: string, childId: string): LayoutNode {
  return updateRegion(tree, regionId, (node) =>
    node.children?.some((child) => child.id === childId) === true
      ? { ...node, active: childId }
      : node,
  );
}

/**
 * Select, in every selector region on the path, the child leading to `id`.
 *
 * Placing a view into a container has to make that container visible, or the view
 * would be placed but shown by nobody: the ancestors are what decide.
 *
 * @param tree - the tree to update.
 * @param id - the region to reveal.
 */
export function revealRegion(tree: LayoutNode, id: string): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === "split") {
      const children = node.children.map(walk);
      return children.some((child, index) => child !== node.children[index])
        ? { ...node, children }
        : node;
    }
    const children = node.children;
    if (children === undefined || children.length === 0) return node;
    // A region's children are regions, so the walk stays in the region type.
    const next = children.map((child) => walk(child) as RegionNode);
    const target = next.find((child) => findRegion(child, id) !== null);
    const changed = next.some((child, index) => child !== children[index]);
    if (target === undefined) return changed ? { ...node, children: next } : node;
    return { ...node, children: next, active: target.id };
  };
  return walk(tree);
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
 * **Placing what is already there is a no-op**, and returns the state itself. `place`
 * is a request about a *result* — "this view is the one its region shows" — so when
 * that already holds (visible, the region's front, its region revealed) there
 * is nothing to change. Without this the call always bumped the order, so a caller
 * that places *in reaction to a change* produced a fresh change every time, and two
 * such callers never settled: measured, the arrangement (which follows the app's
 * active editor) and the editor plugin (which follows prac's front view) sent the
 * page into an endless place/activate loop — thousands per second, until the main
 * thread stopped answering.
 *
 * @param state - current state.
 * @param viewId - the view identity.
 * @param regionId - the destination region.
 */
export function place(state: LayoutState, viewId: string, regionId: string): LayoutState {
  const current = state.views[viewId];
  if (current !== undefined && !current.hidden) {
    // The landing region is where routing would put it — a container shows a child
    // of its own, not the view directly.
    const landing = landingRegion(state.tree, regionId, viewId).region;
    const front = frontView(state, landing);
    if (
      current.region === landing &&
      front === viewId &&
      revealRegion(state.tree, landing) === state.tree
    ) {
      return state;
    }
  }
  const next = placeQuietly(state, viewId, regionId);
  // Placing into a container shows that container: the selector ancestors are
  // what decide which child is on screen. The *landing* region is the one to
  // reveal — routing may have put the view in a child of the region named.
  const landing = next.views[viewId]?.region ?? regionId;
  const tree = revealRegion(next.tree, landing);
  return tree === next.tree ? next : { ...next, tree };
}

/**
 * A node id the tree does not already use.
 *
 * The frame **persists its tree** across page loads, while the counter that names new
 * regions and splits starts over each load — so a split made after a reload can mint the
 * very id a restored node already has. Two nodes with one id are two regions as far as the
 * frame is concerned (it keys a region by its id), and the views placed in that region are
 * mounted in **both** copies: measured, one file's second placement had two hosts, one of
 * them empty, and the file's view was mounted twice.
 *
 * @param tree - the tree the new node will join.
 * @param kind - the id's prefix (`region`, `split`).
 * @param next - the counter to advance for each candidate.
 * @returns an id no node in the tree carries.
 */
export function freshNodeId(tree: LayoutNode, kind: string, next: () => number): string {
  let id = `${kind}-${next()}`;
  while (nodeWithId(tree, id) !== null) id = `${kind}-${next()}`;
  return id;
}

/**
 * The node carrying an id, anywhere in the tree.
 *
 * @param node - the subtree to search.
 * @param id - the id to look for.
 */
function nodeWithId(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = nodeWithId(child, id);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Forget a view's placement record entirely.
 *
 * The frame persists its arrangement, so a record outlives the page that made it — which
 * is what makes a *hidden* view mean "the person put this away, and it is still there to
 * come back to". A **file** view is a different kind of thing: it exists because the app
 * has that file open, and once the app no longer does, there is no subject left to
 * remember. Keeping the record is not just dead weight — the id is reused the next time
 * the app opens that file (placements are named by the host, and a placement is new
 * again), so a remembered record would **block** the new placement from being shown.
 *
 * A selector region that exists only to hold this view is dropped with it.
 *
 * @param state - current state.
 * @param viewId - the view to forget.
 * @returns the next state, or the same one when there was nothing to forget.
 */
export function removeView(state: LayoutState, viewId: string): LayoutState {
  if (state.views[viewId] === undefined) return state;
  const views = { ...state.views };
  delete views[viewId];
  return { ...state, views, tree: dropOwnChild(state.tree, viewId) };
}

/**
 * Drop the child region a selector region created for one view (`landingRegion`).
 *
 * @param tree - the tree to update.
 * @param viewId - the view whose child is going.
 */
function dropOwnChild(tree: LayoutNode, viewId: string): LayoutNode {
  if (tree.type === "split") {
    const children = tree.children.map((child) => dropOwnChild(child, viewId));
    return children.some((child, index) => child !== tree.children[index])
      ? { ...tree, children }
      : tree;
  }
  if (tree.children === undefined) return tree;
  const kept = tree.children.filter((child) => child.id !== `${tree.id}/${viewId}`);
  return kept.length === tree.children.length ? tree : { ...tree, children: kept };
}

/**
 * Place a view **without** changing which child its region shows.
 *
 * The arrangement's bulk sync uses this: the source catalogue is the truth about
 * what exists, but the person's choice of container is theirs — a view appearing
 * somewhere must not yank the selection.
 *
 * @param state - current state.
 * @param viewId - the view identity.
 * @param regionId - the destination region.
 */
export function placeQuietly(state: LayoutState, viewId: string, regionId: string): LayoutState {
  const view = ensureView(state, viewId);
  // Open order: a view that is new to this region goes to the **end** of its strip
  // (VS Code appends tabs), and a view that already lives here keeps its place — a
  // placement brings it to the front without moving it.
  const arriving = state.views[viewId] === undefined || state.views[viewId]?.region !== regionId;
  // A region that selects among children shows none of its own views, so a
  // direct placement into it lands in a child of its own — "a container with
  // one view", the shape the design gives a view that stands alone.
  const landing = landingRegion(state.tree, regionId, viewId);
  // A view arriving in the region goes after the ones already there; one that is
  // already there keeps its order (so activating never moves a tab).
  const order = arriving ? maxOrder(state, landing.region) + 1 : view.order;
  const views = { ...state.views };
  // At most one front per region: bringing this view forward takes the marker from
  // whichever view held it.
  for (const [id, record] of Object.entries(views)) {
    if (id !== viewId && record.region === landing.region && record.front === true) {
      views[id] = { ...record, front: false };
    }
  }
  views[viewId] = { ...view, region: landing.region, hidden: false, order, front: true };
  return { ...state, tree: landing.tree, views };
}

/**
 * One past the last tab position in a region.
 *
 * @param state - current state.
 * @param regionId - the region.
 * @returns the order a newly arriving view takes.
 */
function maxOrder(state: LayoutState, regionId: string): number {
  const orders = Object.entries(state.views)
    .filter(([, view]) => view.region === regionId)
    .map(([, view]) => view.order);
  return orders.length === 0 ? -1 : Math.max(...orders);
}

/** A view id's tail, as a child region's name when nothing better is known. */
function viewLabelOf(viewId: string): string {
  return (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");
}

/**
 * Where a view placed "into" a region actually lands.
 *
 * A plain region shows its own views, so it takes the view as-is. A region that
 * selects among children shows only one child, so the view gets a child of its
 * own (created on demand) and that child is selected — otherwise the view would
 * be placed but shown by nobody.
 *
 * @param tree - the tree to update.
 * @param regionId - the region the caller named.
 * @param viewId - the view being placed.
 */
function landingRegion(
  tree: LayoutNode,
  regionId: string,
  viewId: string,
): { tree: LayoutNode; region: string } {
  const region = findRegion(tree, regionId);
  if (region?.children === undefined || region.children.length === 0) {
    return { tree, region: regionId };
  }
  const id = `${regionId}/${viewId}`;
  if (region.children.some((child) => child.id === id)) return { tree, region: id };
  const children = [
    ...region.children,
    // A container's children stack: a view landing beside others shares the strip.
    regionNode(id, 0, { label: viewLabelOf(viewId), stack: true }),
  ];
  return { tree: setRegionChildren(tree, regionId, children), region: id };
}

/**
 * The view a region currently renders: the front of its visible ones.
 *
 * A region shows exactly one view — the most recently placed visible one — which
 * is what makes "the centre holds the focused view" a data fact rather than a
 * rendering rule.
 *
 * @param state - current state.
 * @param regionId - the region to inspect.
 * @returns the front view id, or undefined when the region shows nothing.
 */
export function frontView(state: LayoutState, regionId: string): string | undefined {
  const views = visibleViews(state, regionId);
  return views.find((id) => state.views[id]?.front === true) ?? views[0];
}

/**
 * Make one view the front of its region, without moving it in the strip.
 *
 * @param state - current state.
 * @param viewId - the view to bring to the front.
 * @returns the next state, or the same one when it is already front.
 */
export function setFront(state: LayoutState, viewId: string): LayoutState {
  const view = state.views[viewId];
  if (view === undefined || view.front === true) return state;
  const views = { ...state.views };
  for (const [id, record] of Object.entries(views)) {
    if (record.region === view.region && record.front === true) {
      views[id] = { ...record, front: false };
    }
  }
  views[viewId] = { ...view, front: true };
  return { ...state, views };
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
  const children = node.children;
  if (children !== undefined && children.length > 0) {
    return node.flex || children.some((child) => isPresent(state, child));
  }
  return node.flex || visibleViews(state, node.id).length > 0;
}

/**
 * Whether a region renders its views as a stack of headers rather than bare.
 *
 * A stack region of one renders bare on purpose: a single-view region must look
 * and measure exactly as it did before stacking existed, so the header is a cost
 * paid only when a second visible view arrives.
 *
 * This is the render *decision*, kept here (not in the frame) so it can be
 * tested without a DOM: the frame only carries out what this returns.
 *
 * @param state - current state.
 * @param node - the region to test.
 */
export function isStacked(state: LayoutState, node: LayoutNode): boolean {
  return node.type === "region" && node.stack === true && visibleViews(state, node.id).length > 1;
}

/**
 * Whether a region renders a **tab strip** rather than bare or stacked views.
 *
 * The mode is VS Code's `showTabs` vocabulary (`contract.ts`), and the count it
 * is compared against is the region's visible views — the same list the stack
 * and the bare rendering use.
 *
 * @param state - current state.
 * @param node - the region to test.
 */
export function showsTabStrip(state: LayoutState, node: LayoutNode): boolean {
  if (node.type !== "region") return false;
  const count = visibleViews(state, node.id).length;
  if (node.tabs === "multiple") return count >= 1;
  if (node.tabs === "single") return count > 1;
  return false;
}

/**
 * The two sizes a sash drag produces; only the regions that change are present.
 */
export interface SashSizes {
  /** The new size of the region before the sash, when it changes. */
  a?: number;
  /** The new size of the region after the sash, when it changes. */
  b?: number;
}

/**
 * The two sizes a drag produces. `null` means "this boundary does not move"
 * (flex|flex): two flexible siblings share the remainder, so there is no size to
 * write. Only the region/regions that actually change are returned.
 *
 * `delta` is the pointer movement along the split axis (right/down positive).
 * `budget` is the extent this *pair* may share: the split's content extent, net
 * of its sashes and of every other child's minimum.
 *
 * Both neighbours are clamped at their `min`, and the shrinking one keeps at
 * least its own: without the shared budget a growing fixed region can starve its
 * flex siblings to zero (the sash then has a lower bound but no upper one).
 *
 * @param a - the region before the sash.
 * @param b - the region after the sash.
 * @param delta - pointer movement along the split axis, in px.
 * @param budget - the extent the pair may share, in px.
 */
export function sashSizes(
  a: RegionNode,
  b: RegionNode,
  delta: number,
  budget: number,
): SashSizes | null {
  if (a.flex && b.flex) return null;
  if (!a.flex && !b.flex) {
    const total = a.size + b.size;
    const upper = Math.max(a.min, budget - b.min);
    const grew = Math.min(Math.max(a.size + delta, a.min), upper);
    const shrunk = Math.max(b.min, total - grew);
    return { a: total - shrunk, b: shrunk };
  }
  if (!a.flex) {
    const upper = Math.max(a.min, budget - b.min);
    return { a: Math.min(Math.max(a.size + delta, a.min), upper) };
  }
  const upper = Math.max(b.min, budget - a.min);
  return { b: Math.min(Math.max(b.size - delta, b.min), upper) };
}

/**
 * The smallest extent a subtree can occupy along its split axis: the sum of its
 * regions' minima, so a split's budget can reserve room for children the drag is
 * not touching.
 *
 * @param node - the subtree to measure.
 */
export function subtreeMin(node: LayoutNode): number {
  if (node.type === "split")
    return node.children.reduce((total, child) => total + subtreeMin(child), 0);
  const children = node.children;
  if (children !== undefined && children.length > 0) {
    // One child is shown at a time, so the selector needs the widest child's room.
    return Math.max(node.min, ...children.map((child) => subtreeMin(child)));
  }
  return node.min;
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
      // A selector region hands its whole box to the child it shows.
      const child = activeChild(state, node);
      if (child !== null) visit(child, w, h);
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

/** The split axis and child order a {@link Side} implies. */
export interface SideGeometry {
  /** The axis that side splits along. */
  readonly dir: Dir;
  /** Whether the new sibling goes before the source region. */
  readonly before: boolean;
}

/**
 * Resolve a side into the geometry the tree needs.
 *
 * @param side - the side the new region goes on.
 */
export function sideGeometry(side: Side): SideGeometry {
  return {
    dir: side === "left" || side === "right" ? "row" : "column",
    before: side === "left" || side === "up",
  };
}

/**
 * Replace a region with a split of the original region and a new one beside it.
 *
 * The new region is **flexible**, in both cases deliberately:
 *
 * - when the source is flexible, the two siblings then share the extent evenly
 *   (`resolveSizes` hands every flex child an equal share), which is what
 *   "split the work area" should look like;
 * - when it is fixed, it keeps its size and the new sibling absorbs the
 *   remainder of the split's own extent.
 *
 * The new region is *not* rendered while it is empty (see `isPresent`), so the
 * caller is expected to move a view into it — that is why the face's door is
 * `splitView`, not "split a region and hope".
 *
 * @param state - current state.
 * @param regionId - the region to split.
 * @param side - which side of it the new region goes on.
 * @param splitId - id for the replacement split.
 * @param newRegionId - id for the new region.
 */
export function splitRegionWith(
  state: LayoutState,
  regionId: string,
  side: Side,
  splitId: string,
  newRegionId: string,
): LayoutState {
  const node = findRegion(state.tree, regionId);
  if (!node) return state;
  const { dir, before } = sideGeometry(side);
  const fresh = regionNode(newRegionId, 0, {
    flex: true,
    min: DEFAULT_MIN,
    // A split is a second area of the **same kind**: it shows the chrome the region it
    // came from shows. The centre carries `tabs: "multiple"`, so a region split off it
    // has a tab strip for the views it holds — which is what a person expects of an
    // editor group they just created.
    ...(node.tabs === undefined ? {} : { tabs: node.tabs }),
  });
  const replacement: SplitNode = {
    type: "split",
    id: splitId,
    dir,
    children: before ? [fresh, node] : [node, fresh],
  };
  return { ...state, tree: replaceNode(state.tree, regionId, () => replacement) };
}
