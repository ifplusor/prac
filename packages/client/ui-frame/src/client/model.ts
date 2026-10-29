/**
 * The layout model: pure functions over the region tree and the views table.
 *
 * Nothing here touches React or the DOM — placement is data, so `place`,
 * `setCollapsed` and `splitRegionWith` are ordinary tree rewrites that the store
 * commits and the frame renders.
 *
 * @module prac-client-ui-frame/client/model
 */

import type { RegionInfo } from "./catalogue.js";
import {
  BOTTOM_REGION,
  type GridNode,
  CENTER_MIN,
  CENTER_REGION,
  DEFAULT_MIN,
  type LayoutPriority,
  type Sizing,
  type Box,
  type Dir,
  type GridPlacement,
  type LayoutNode,
  type LayoutState,
  type RegionNode,
  type RegionSelector,
  type Side,
  type SplitNode,
  type ViewRecord,
} from "./contract.js";
import { allocateContent, allocateStack, isStackSplit, nodeBasis } from "prac-ui-kit";
import {
  findNode,
  findRegion,
  findSplit,
  firstRegionId,
  replaceNode,
  updateRegion,
} from "prac-ui-kit";
export {
  findNode,
  findRegion,
  findSplit,
  firstRegionId,
  freshNodeId,
  replaceNode,
  subtreeMin,
  updateRegion,
} from "prac-ui-kit";
export { allocateContent, allocateStack, isStackSplit, nodeBasis } from "prac-ui-kit";
export type { Basis } from "prac-ui-kit";

/** VS Code's resize order: high gives way first, low last. */
const priorityRank = (priority: LayoutPriority | undefined): number =>
  priority === "high" ? 0 : priority === "low" ? 2 : 1;

/** A claim clamped into its own bounds. */
const clampClaim = (basis: { readonly max: number; readonly min: number }, size: number): number =>
  Math.min(basis.max, Math.max(basis.min, Math.round(size)));

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

/** Build a row-major grid node from its cells. */
export function gridNode(
  id: string,
  rows: number,
  columns: number,
  children: readonly LayoutNode[],
  extra: Partial<GridNode> = {},
): GridNode {
  if (children.length > rows * columns) {
    throw new Error(`grid ${id} has more cells than its ${rows}x${columns} shape`);
  }
  return { type: "grid", id, rows, columns, children, ...extra };
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
/**
 * The child a selector region **records** as its choice, whether or not it has anything to show.
 *
 * `activeChild` answers "what should be on screen", and falls back when the recorded choice is empty
 * (an empty region is not rendered — H1). This answers the other question — "what did the person
 * pick" — which is what the bar marks as active and what an empty pane is named after.
 *
 * @param state - the layout state.
 * @param node - the selector region.
 * @returns the recorded child, or null when there is none (or nothing is recorded).
 */
export function chosenChild(state: LayoutState, node: RegionNode): LayoutNode | null {
  const children = node.children;
  if (children === undefined || node.active === undefined) return null;
  return children.find((child) => child.id === node.active) ?? null;
}

export function activeChild(state: LayoutState, node: RegionNode): LayoutNode | null {
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
          // VS Code's own convention, straight from its parts: the editor group is `High`
          // (`editorPart.ts`), the side bars and the panel are `Low` (`sidebarPart.ts`). A `High`
          // block is resized first, so when the window runs short the centre gives way and the
          // tracks keep their size.
          regionNode("left", 280, { stack: true, priority: "low", snap: true }),
          // The centre is the editor group of this layout: it gets the tab strip
          // (VS Code's default `showTabs: "multiple"`), and it stays flexible so an
          // empty work area is still present.
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
      // Empty at boot: an empty region is not rendered, so this costs the default
      // layout nothing and appears (at its size) as soon as something lands in it.
      regionNode(BOTTOM_REGION, 240, { stack: true, priority: "low", snap: true }),
    ],
  };
}

// ── tree helpers (all pure) ───────────────────────────────────────────

/**
 * The first region inside a **window group cell** (the first cell of the first
 * grid), or undefined when the tree has no grid.
 *
 * This is the fallback home for a placement whose named window group is gone. A
 * view whose region no longer exists used to be recorded against that dead id —
 * it then rendered nowhere while still counting as placed, so the app called
 * `place` again on every pass and the window never came back. The first cell is
 * the closest live equivalent of the group that disappeared, and unlike the
 * first region in tree order it is not a sidebar.
 *
 * @param node - subtree root.
 * @returns the region id, or undefined when no grid has a cell.
 */
export function firstWindowGroupRegion(node: LayoutNode): string | undefined {
  if (node.type === "grid") {
    const cell = node.children[0];
    return cell === undefined ? undefined : firstRegionId(cell);
  }
  for (const child of childNodes(node)) {
    const found = firstWindowGroupRegion(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Every region in the subtree, in tree order (left-to-right, top-to-bottom).
 *
 * @param node - subtree root.
 * @returns one entry per region, in tree order.
 */
export function regionInfos(node: LayoutNode): RegionInfo[] {
  if (node.type === "grid") return node.children.flatMap((child) => regionInfos(child));
  if (node.type === "split") {
    // A stack is **one** position (its split id), not a list of internal leaves: a row is not a
    // place a view can be moved to. The split's id is what `place`/`select` address.
    if (isStackSplit(node, node.children)) return [{ id: node.id, collapsed: false }];
    return node.children.flatMap((child) => regionInfos(child));
  }
  return [
    { id: node.id, collapsed: node.collapsed ?? false },
    ...(node.children ?? []).flatMap((child) => regionInfos(child)),
  ];
}

/**
 * Return a new tree with one region's fixed size changed.
 *
 * @param tree - the tree to update.
 * @param id - region id.
 * @param size - requested size in px (rounded, clamped at 0).
 */
export function setRegionSize(tree: LayoutNode, id: string, size: number): LayoutNode {
  // Never negative, and **not** clamped to `min`: collapse writes 0 through the same door, and keeping
  // a drag inside `min` / `max` is `resizeBoundary`'s job.
  return updateRegion(tree, id, (node) => ({ ...node, size: Math.max(0, Math.round(size)) }));
}

/**
 * Write a child's extent along its parent's axis, for a region **or** a split standing in for one.
 *
 * `flex` is left as it was: a child that shared the leftover keeps doing so, now with the size it was
 * given as its weight, which is how a dragged boundary keeps its proportions when the frame changes.
 *
 * @param tree - the tree to edit.
 * @param id - the child to size.
 * @param size - the wanted extent in px.
 * @returns the tree, or the same tree when nothing moved.
 */
export function setNodeSize(tree: LayoutNode, id: string, size: number): LayoutNode {
  const wanted = Math.max(0, Math.round(size));
  const current = findNode(tree, id);
  if (current === null) return tree;
  const basis = nodeBasis(current);
  const next = Math.min(basis.max, Math.max(0, wanted));
  if (basis.size === next) return tree;
  return replaceNode(tree, id, (node) =>
    node.type === "split" ? { ...node, size: next } : { ...node, size: next },
  );
}

/**
 * Move the boundary between two children of a split.
 *
 * The two sides of the sash are ordered **nearest first**, with `priority` deciding who is consider-
 * first (`high` first, `low` last — VS Code's `LayoutPriority`); the drag is clamped to what the pair
 * can actually do (`max` on the side that grows, `min` on the side that shrinks), and the space is
 * handed out by `sizing`: `"distribute"` spreads it over the whole side **in proportion** (VS Code
 * `DistributeSizing`, the default), `"expand"` pushes the nearest child only, one at a time.
 *
 * @param state - the layout state.
 * @param splitId - the split whose boundary moves.
 * @param index - the boundary's position: the index of the child **after** it, among the split's
 * present children (so the first boundary is 1, as the frame numbers its sashes).
 * @param delta - how far the boundary moves, in px (positive grows the children before it).
 * @param sizing - how the space is handed out.
 * @param current - what the children are **drawn** at, when the caller knows (a DOM drag does). The
 * tree's own `size` is only a claim: a flexible block that nobody has dragged claims nothing at all,
 * so a drag has to start from the pixels on screen.
 * @returns the state, or the same state when nothing moved.
 */
export function resizeBoundary(
  state: LayoutState,
  splitId: string,
  index: number,
  delta: number,
  sizing: Sizing = "distribute",
  current?: ReadonlyMap<string, number>,
): LayoutState {
  const node = findNode(state.tree, splitId);
  if (node === null || node.type !== "split") return state;
  const present = node.children.filter((child) => isPresent(state, child));
  if (index < 1 || index >= present.length) return state;

  const ordered = (list: readonly LayoutNode[]): LayoutNode[] =>
    [...list].sort(
      (a, b) => priorityRank(nodeBasis(a).priority) - priorityRank(nodeBasis(b).priority),
    );
  const up = ordered(present.slice(0, index).reverse());
  const down = ordered(present.slice(index));
  const sizes = new Map<string, number>(
    present.map((child) => [child.id, current?.get(child.id) ?? nodeBasis(child).size]),
  );
  const headroom = (list: readonly LayoutNode[], sign: 1 | -1): number =>
    list.reduce((total, child) => {
      const basis = nodeBasis(child);
      const head = sign > 0 ? basis.max - sizes.get(child.id)! : sizes.get(child.id)! - basis.min;
      return total + Math.max(0, head);
    }, 0);
  // Both sides must be able to absorb the movement in **each** direction: a positive delta grows
  // the up side and shrinks the down side, a negative one does the reverse. Clamping with only the
  // receiver's headroom let a drag squeeze a side past its floor (or past its ceiling); the two
  // headrooms have to bound the movement together.
  const lower = -Math.min(headroom(up, -1), headroom(down, 1));
  const upper = Math.min(headroom(up, 1), headroom(down, -1));
  const moved = Math.max(lower, Math.min(upper, delta));

  if (moved !== 0) {
    if (sizing === "expand") {
      let room = moved;
      for (const child of up) {
        const basis = nodeBasis(child);
        const next = clampClaim(basis, sizes.get(child.id)! + room);
        room -= next - sizes.get(child.id)!;
        sizes.set(child.id, next);
      }
      let taken = moved;
      for (const child of down) {
        const basis = nodeBasis(child);
        const next = clampClaim(basis, sizes.get(child.id)! - taken);
        taken -= sizes.get(child.id)! - next;
        sizes.set(child.id, next);
      }
    } else {
      const spread = (list: readonly LayoutNode[], amount: number): void => {
        let left = Math.abs(amount);
        let open = [...list];
        while (left > 1e-6 && open.length > 0) {
          const held = open.map((child) => sizes.get(child.id)!);
          const weights = held.some((size) => size > 0) ? held : open.map(() => 1);
          const total = weights.reduce((sum, weight) => sum + weight, 0);
          let used = 0;
          const next: LayoutNode[] = [];
          open.forEach((child, position) => {
            const basis = nodeBasis(child);
            const share = (left * weights[position]!) / total;
            const head =
              amount > 0 ? basis.max - sizes.get(child.id)! : sizes.get(child.id)! - basis.min;
            const take = Math.max(0, Math.min(share, head));
            sizes.set(child.id, sizes.get(child.id)! + Math.sign(amount) * take);
            used += take;
            if (head - take > 1e-6) next.push(child);
          });
          left -= used;
          open = next;
          if (used <= 1e-6) break;
        }
      };
      spread(up, moved);
      spread(down, -moved);
    }
  }

  let tree = state.tree;
  for (const [id, size] of sizes) tree = setNodeSize(tree, id, size);
  return tree === state.tree ? state : { ...state, tree };
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
  children: readonly LayoutNode[],
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
 * Whether the frame draws the region's selector strip.
 *
 * Only a `"title"` selector lives **inside** the region's box, so only it reserves height. A
 * `"rail"` is the dock bar outside the region, and `"none"` draws no selector at all; neither may
 * leave the allocation short of the box the region is drawn in. Absent keeps the pre-dock rule: a
 * strip whenever there is more than one child.
 *
 * @param node - the region to test.
 */
export function drawsRegionBar(node: RegionNode): boolean {
  if ((node.children?.length ?? 0) < 2) return false;
  return node.selector !== "rail" && node.selector !== "none";
}

/**
 * Set how a region presents its choice among its children (see {@link RegionNode.selector}).
 *
 * @param tree - the tree to update.
 * @param regionId - the region to configure.
 * @param selector - the presentation to use.
 * @returns the new tree, or the same one when nothing changes.
 */
export function setRegionSelector(
  tree: LayoutNode,
  regionId: string,
  selector: RegionSelector,
): LayoutNode {
  return updateRegion(tree, regionId, (node) =>
    node.selector === selector ? node : { ...node, selector },
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
    const next = children.map((child) => walk(child));
    // A child may be a split (a stack took the region's place in this list), so ask "does this
    // subtree hold the id" with `findNode` — `findRegion` answers a different question.
    const target = next.find((child) => findNode(child, id) !== null);
    const changed = next.some((child, index) => child !== children[index]);
    if (target === undefined) return changed ? { ...node, children: next } : node;
    // Already selected: returning a fresh object here made `place`'s "nothing to do" check fail
    // forever, so every activation re-placed the view and bumped its order (measured).
    if (!changed && node.active === target.id) return node;
    return { ...node, children: next, active: target.id };
  };
  return walk(tree);
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
  return ensureStackShape(tree === next.tree ? next : { ...next, tree });
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
  // A region that selects among children shows none of its own views, so a
  // direct placement into it lands in a child of its own — "a container with
  // one view", the shape the design gives a view that stands alone.
  const landing = landingRegion(state.tree, regionId, viewId);
  // No live window group to land in: placing anyway would record a home that
  // no renderer can find.
  if (landing.region === "") return state;
  // Open order: a view that is new to this region goes to the **end** of its strip
  // (VS Code appends tabs), and a view that already lives here keeps its place — a
  // placement brings it to the front without moving it. "New" is judged against the
  // **landing** region: a view already in one of a stack's rows is not arriving just
  // because the caller named the split.
  const arriving =
    state.views[viewId] === undefined || state.views[viewId]?.region !== landing.region;
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
  // A placement is where a stack appears or changes shape: normalise on the way out.
  return ensureStackShape({ ...state, tree: landing.tree, views });
}

/**
 * One past the last tab position in a region.
 *
 * @param state - current state.
 * @param regionId - the region.
 * @returns the order a newly arriving view takes.
 */
function maxOrder(state: LayoutState, regionId: string): number {
  // A stack's views live in its rows, not directly in the region: ask the split for them too, or a
  // placement into a stack would always get order 0.
  const split = findSplit(state.tree, regionId);
  const rowIds = new Set(split === null ? [] : stackEntries(split).map((row) => row.id));
  const orders = Object.entries(state.views)
    .filter(([, view]) => view.region === regionId || rowIds.has(view.region))
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
  const stack = findSplit(tree, regionId);
  const rows = stack === null ? [] : stackEntries(stack);
  if (region === null || region.children === undefined || region.children.length === 0) {
    // The target may be a **stack**: a view already one of its rows belongs to that row. Without
    // this a placement reads it as "not there yet" and re-rows it on every pass. A stack is a
    // split, not a region, so this is also how a placement addressed to the split id lands in
    // its existing row.
    if (rows.length > 0) {
      const home = rows.find((row) => row.id.endsWith(`/stack/${viewId}`));
      return { tree, region: home?.id ?? regionId };
    }
    if (region !== null) return { tree, region: regionId };
    // The named window group is gone (or the caller named a container such as the
    // stage grid). Land in the first live window group instead of writing a record
    // that points at a region no renderer can find. With no live group at all there
    // is nowhere to land, so the placement stays a no-op rather than inventing one.
    const fallback = firstWindowGroupRegion(tree);
    return fallback === undefined ? { tree, region: "" } : { tree, region: fallback };
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
/**
 * Move a view next to another one **inside the same region** — the stack's drag-to-reorder.
 *
 * Upstream states a move as **reference + direction** (`Grid.moveView(view, sizing, referenceView,
 * direction)`, `grid.ts:480-495`; `Direction.Up` / `Direction.Down`, `editorPart.ts:807-810`), and
 * within one parent that is a pure reorder. A region's order is its views' `order` field
 * (`visibleViews` sorts by it), so the move renumbers that field: the dragged view lands immediately
 * before or after the reference, and everything else keeps its relative position — including views
 * that are currently hidden. The view keeps its own height and fold state; only `order` changes
 * (`moveView` passes no `Sizing`, `grid.ts:480-495`).
 *
 * @param state - current state.
 * @param viewId - the view being moved.
 * @param referenceViewId - the view it is dropped against.
 * @param direction - `"up"` lands it before the reference, `"down"` after it.
 * @returns the new state, or the same state when the move changes nothing.
 */
export function moveViewInRegion(
  state: LayoutState,
  viewId: string,
  referenceViewId: string,
  direction: "up" | "down",
): LayoutState {
  const view = state.views[viewId];
  const reference = state.views[referenceViewId];
  if (view === undefined || reference === undefined) return state;
  // Moving across regions is `place`, a different mechanism; this one only reorders.
  if (view.region !== reference.region) return state;
  if (viewId === referenceViewId) return state;
  const strip = Object.entries(state.views)
    .filter(([, entry]) => entry.region === view.region)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
  const others = strip.filter((id) => id !== viewId);
  const at = others.indexOf(referenceViewId);
  if (at < 0) return state;
  const target = direction === "up" ? at : at + 1;
  const next = [...others.slice(0, target), viewId, ...others.slice(target)];
  if (next.every((id, index) => id === strip[index])) return state;
  const views = { ...state.views };
  next.forEach((id, index) => {
    const entry = views[id];
    if (entry !== undefined && entry.order !== index) views[id] = { ...entry, order: index };
  });
  return { ...state, views };
}

/**
 * Shape every stack in the tree the way the design states it: **a `column` split whose children are
 * one-view regions**.
 *
 * A region in `stack` mode that holds two or more visible views stops being a region that holds
 * views: it becomes a split of leaves, one per view, and the views' `region` moves to their leaf.
 * Heights and folds move with them — a leaf's `size` **is** the row's height (`splitview.ts:60-84`
 * is upstream's version of the same idea) — so the drawn height and the stored height are the same
 * number by construction, which is what `ViewRecord.size` used to break.
 *
 * Two things keep a second pass cheap and safe:
 *
 * - the split takes the **region's own id**, so a named region (`left`, `center`, …) keeps the name
 *   its role binding is looked up by;
 * - a leaf's id is derived from the region and the view (`<region>/stack/<viewId>`), so reordering
 *   does not rename anything and a normalised state normalises to itself.
 *
 * Regions that hold one visible view, and regions in `tabs` mode (which has no height semantics),
 * are left exactly as they are.
 *
 * @param state - current state.
 * @returns the shaped state, or the same state when every stack already has that shape.
 */
export function ensureStackShape(state: LayoutState): LayoutState {
  let changed = false;
  const views = { ...state.views };

  /** One view's leaf: the id is derived, the height/fold moves from the record. */
  const leafFor = (regionId: string, viewId: string): RegionNode => {
    const view = state.views[viewId];
    // A row nobody sized stays **flexible** so the rows keep sharing the height equally, the way a
    // stack does before anyone touches it; a row that was sized keeps that height. A folded row has
    // no height of its own (`size = 0`, E1) — its header is drawn from `collapsed` + `HEADER_HEIGHT`
    // — and its memory is `cachedSize`.
    const sized = view?.size;
    const folded = view?.collapsed === true;
    const leaf = regionNode(`${regionId}/stack/${viewId}`, folded ? 0 : (sized ?? 0), {
      min: MIN_ENTRY,
      entry: true,
      flex: folded ? false : sized === undefined,
      ...(sized !== undefined && !folded ? { size: sized } : {}),
      ...(folded ? { collapsed: true } : {}),
      ...(view?.cachedSize !== undefined ? { cachedSize: view.cachedSize } : {}),
      // The ceiling is the view's to declare; the layout only reads it.
      ...(view?.max === undefined ? {} : { max: view.max }),
    });
    const record = views[viewId];
    if (record !== undefined && record.region !== leaf.id) {
      // The height lives in the tree now; the record no longer carries one (G1: `tabs` has none).
      const { size: _size, cachedSize: _cached, ...rest } = record;
      views[viewId] = { ...rest, region: leaf.id, collapsed: undefined };
      changed = true;
    }
    return leaf;
  };

  // Read the **working** map, not `state.views`: `leafFor` re-points a view at the leaf it just
  // made, and a reader on the old map would see every fresh row as empty and melt it away.
  const visibleIn = (regionId: string): string[] =>
    Object.entries(views)
      .filter(([, view]) => view.region === regionId && !view.hidden)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);

  /**
   * Move a row's height and fold back onto the view record when the row stops being a row.
   *
   * This is the one-view interlude (A4/melt): a lone view has no header, so its fold has nowhere to
   * be drawn; the record is where it waits until a second view makes the region a stack again.
   */
  const writeBack = (viewId: string, row: RegionNode, regionId: string): void => {
    const record = views[viewId];
    if (record === undefined) return;
    const base = { ...record, region: regionId };
    if (row.collapsed === true) {
      views[viewId] = {
        ...base,
        collapsed: true,
        size: 0,
        cachedSize: row.cachedSize ?? row.size,
      };
    } else if (row.flex === true && row.size === 0) {
      views[viewId] = { ...base, collapsed: undefined, size: undefined, cachedSize: undefined };
    } else {
      views[viewId] = { ...base, collapsed: undefined, size: row.size, cachedSize: row.size };
    }
    changed = true;
  };

  /** A one-row stack is a bare region again: the design shows a lone view without a header. */
  const melt = (
    node: SplitNode,
    rows: readonly RegionNode[],
    size: number,
    flex: boolean,
  ): LayoutNode => {
    const kept = rows.find((row) => visibleIn(row.id).length > 0);
    // Nothing left to show: the leftover must not hold space. A **flexible** region counts as present
    // while empty (`isPresent`), which would leave an empty bottom bar on screen.
    if (kept === undefined) {
      return regionNode(node.id, size, {
        flex: false,
        min: MIN_ENTRY,
        stack: true,
        ...(node.label === undefined ? {} : { label: node.label }),
      });
    }
    const viewId = visibleIn(kept.id)[0];
    if (viewId !== undefined) writeBack(viewId, kept, node.id);
    // The region's `collapsed` is a **track** collapse, not the row's fold: the view's fold moved
    // back to its record above, and a second view turns the region into a stack again.
    return regionNode(node.id, size, {
      flex,
      min: MIN_ENTRY,
      stack: true,
      ...(node.label === undefined ? {} : { label: node.label }),
    });
  };

  /** The order a child row's view holds (F7: one order for the region). */
  const orderOf = (child: LayoutNode): number => {
    if (child.type !== "region" || child.entry !== true) return Number.POSITIVE_INFINITY;
    const viewId = visibleIn(child.id)[0];
    return viewId === undefined ? Number.POSITIVE_INFINITY : (views[viewId]?.order ?? 0);
  };

  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === "split") {
      const children = node.children.map(walk);
      const isStack = stackEntries({ ...node, children }).length === children.length;
      if (!isStack) {
        if (children.every((child, index) => child === node.children[index])) return node;
        changed = true;
        return { ...node, children };
      }
      let dirty = !children.every((child, index) => child === node.children[index]);
      // Reconcile the rows with the views. A row with no visible view is not a row (A4); a row with
      // more than one visible view is split, one leaf each; a visible view pointing at the split is a
      // stray and becomes a row (this is how a hidden view comes back).
      const next: LayoutNode[] = [];
      for (const child of children) {
        if (child.type !== "region" || child.entry !== true) {
          next.push(child);
          continue;
        }
        const rowViews = visibleIn(child.id);
        if (rowViews.length === 0) {
          for (const [viewId, record] of Object.entries(views)) {
            if (record.region === child.id) writeBack(viewId, child, node.id);
          }
          dirty = true;
          continue;
        }
        next.push(child);
        for (const viewId of rowViews.slice(1)) {
          next.push(leafFor(node.id, viewId));
          dirty = true;
        }
      }
      for (const viewId of visibleIn(node.id)) {
        next.push(leafFor(node.id, viewId));
        dirty = true;
      }
      next.sort((a, b) => orderOf(a) - orderOf(b));
      if (
        next.length !== children.length ||
        next.some((child, index) => child !== children[index])
      ) {
        dirty = true;
      }
      if (dirty) changed = true;
      const rows = next.filter(
        (child): child is RegionNode => child.type === "region" && child.entry === true,
      );
      const shown = rows.filter((row) => visibleIn(row.id).length > 0);
      if (shown.length < 2) {
        changed = true;
        return melt(node, shown.length > 0 ? shown : rows, node.size ?? 0, node.flex ?? true);
      }
      if (!dirty) return node;
      return { ...node, children: next };
    }
    // A region can hold child regions (the container layer); shape those first.
    let region = node;
    if (region.children !== undefined && region.children.length > 0) {
      const children = region.children.map(walk);
      if (!children.every((child, index) => child === region.children?.[index])) {
        region = { ...region, children };
        changed = true;
      }
      // A region with children **selects** among them; its own views are not a stack of rows. Leave
      // the shape alone: converting it here would drop the children (measured on the container layer).
      return region;
    }
    if (region.stack !== true) return region;
    const visible = visibleIn(region.id);
    if (visible.length < 2) return region;
    // Already the shape: a column split of one-view leaves, none of them holding a view's own height.
    const shaped =
      region.children !== undefined &&
      region.children.length === visible.length &&
      region.children.every((child, index) => child.id === `${region.id}/stack/${visible[index]}`);
    if (shaped) return region;
    changed = true;
    return {
      type: "split",
      id: region.id,
      dir: "column",
      size: region.size,
      flex: region.flex === true,
      // The split stands in for the region, name included: a bar that lists this region's children
      // reads the label, and a container that became a stack must not turn into its raw id.
      ...(region.label === undefined ? {} : { label: region.label }),
      children: visible.map((viewId) => leafFor(region.id, viewId)),
    };
  };

  let tree = walk(state.tree);

  // A record may still carry the height the layout used to keep there (the same persisted key was in
  // use before rows held it): move it into the row, so an old state keeps the size and the fold it
  // was saved with instead of quietly forgetting them.
  for (const [viewId, record] of Object.entries(views)) {
    if (
      record.size === undefined &&
      record.cachedSize === undefined &&
      record.collapsed === undefined
    ) {
      continue;
    }
    const home = record.region === undefined ? null : findNode(tree, record.region);
    if (home === null || home.type !== "region" || home.entry !== true) continue;
    const folded = record.collapsed === true;
    const from = record.size ?? record.cachedSize;
    tree = updateRegion(tree, home.id, (entry) =>
      folded
        ? {
            ...entry,
            collapsed: true,
            flex: false,
            size: 0,
            cachedSize: from ?? entry.cachedSize ?? entry.size,
          }
        : from === undefined
          ? entry
          : { ...entry, collapsed: false, flex: false, size: from, cachedSize: from },
    );
    const { size: _size, cachedSize: _cached, ...rest } = record;
    views[viewId] = { ...rest, collapsed: undefined };
    changed = true;
  }
  if (!changed) return state;
  return { ...state, tree, views };
}

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
  // A stack's views live in its **rows** (the entry leaves a `column` split holds), so listing a
  // region's views has to look through the split: the rest of the system still asks "which views
  // are in this region" and must keep getting the same answer it always did.
  const split = state.tree === undefined ? null : findSplit(state.tree, regionId);
  const inRows = new Set(split === null ? [] : stackEntries(split).map((entry) => entry.id));
  return Object.entries(state.views)
    .filter(([, view]) => !view.hidden && (view.region === regionId || inRows.has(view.region)))
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id]) => id);
}

/**
 * Whether a region takes part in the layout at all.
 *
 * A collapsed region stays *present* (it renders at 0px, so a collapse is
 * visible in the DOM), and a flexible region always is — the centre work area
 * exists even when empty. A fixed region with nothing visible to show does
 * not: that is what lets the window group close a track by moving its only view
 * away (promoting the VS Code part out of `right` collapses the track).
 *
 * @param state - current state.
 * @param node - the subtree to test.
 */
export function isPresent(state: LayoutState, node: LayoutNode): boolean {
  if (node.type === "grid" || node.type === "split") {
    return node.children.some((child) => isPresent(state, child));
  }
  // A stack row is present only while it has a visible view. Its `flex`/`collapsed` fields describe
  // the header/row, not an empty holding cell; a hidden or removed view must not leave a blank row.
  if (node.entry === true) return visibleViews(state, node.id).length > 0;
  if (node.collapsed) return true;
  const children = node.children;
  if (children !== undefined && children.length > 0) {
    return node.flex || children.some((child) => isPresent(state, child));
  }
  return node.flex || visibleViews(state, node.id).length > 0;
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
 * Sashes are **overlays** (`position: absolute`, like VS Code's `monaco-sash`), not flex children:
 * they take no extent away from the regions. The map records a split's own box as well, because the
 * frame needs it to place the boundary overlay.
 *
 * @param state - current state.
 * @param width - frame width in px.
 * @param height - frame height in px.
 */
/**
 * The rows and columns a grid actually draws at.
 *
 * Without explicit placements the grid **flows**: it uses only as many columns
 * as there are cells (up to its declared capacity), and enough rows to hold
 * them. That keeps a one-cell 2×2 stage full-size instead of quarter-size, while
 * a four-cell stage still uses the full 2×2 shape.
 */
export function gridShape(
  node: Extract<LayoutNode, { type: "grid" }>,
  count: number,
): { columns: number; rows: number } {
  if (node.placements !== undefined) {
    return { columns: Math.max(1, node.columns), rows: Math.max(1, node.rows) };
  }
  const columns =
    count === 3 && node.columns === 2 && node.rows === 2
      ? 3
      : Math.max(1, Math.min(node.columns, count));
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

/**
 * The relative weights of a grid's columns or rows, normalised to the number of
 * tracks actually drawn. Missing weights are equal.
 *
 * @param node - the grid.
 * @param axis - which tracks.
 * @param count - how many tracks are drawn.
 */
export function gridTrackWeights(node: GridNode, axis: "column" | "row", count: number): number[] {
  const source = axis === "column" ? node.columnWeights : node.rowWeights;
  return Array.from({ length: count }, (_, index) => {
    const value = source?.[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
  });
}

/**
 * The effective placement of every grid cell, with flow positions filled in for
 * cells that have no explicit placement yet.
 *
 * @param node - the grid.
 * @returns one placement per child id.
 */
export function gridPlacements(node: GridNode): Record<string, GridPlacement> {
  const shape = gridShape(node, node.children.length);
  return Object.fromEntries(
    node.children.map((child, index) => [
      child.id,
      node.placements?.[child.id] ?? {
        row: Math.floor(index / shape.columns),
        column: index % shape.columns,
      },
    ]),
  );
}

/**
 * Tighten a grid to the cells it still has.
 *
 * A grid's `placements` name cells by id, and a cell can leave the grid by more
 * than one route (a view's region is closed, a merge folds one into another).
 * The surviving cells keep their coordinates, so a track can end up with no
 * cell at all: the stage then reserves an empty column or row while the rest of
 * the shell lays itself out beside it. This drops placements for children that
 * are gone, closes empty leading/middle tracks by shifting the later cells
 * back, drops merge snapshots whose split is gone, and shrinks `rows` /
 * `columns` to the used extent. Weights are remapped with the tracks they
 * belong to.
 *
 * @param node - the grid to compact.
 * @returns the same node when it is already tight, a new node otherwise.
 */
export function compactGrid(node: GridNode): GridNode {
  // A flow grid (no explicit placements) recomputes its tracks from the child
  // count, so a removed child cannot leave a blank track behind.
  if (node.placements === undefined) return node;
  const present = new Set(node.children.map((child) => child.id));
  // The active **window group** is a child id; a cell that left the grid cannot
  // stay the active one (the stage would keep naming a group nobody can see).
  const active =
    node.active === undefined || present.has(node.active) ? node.active : node.children[0]?.id;
  const placements: Record<string, GridPlacement> = {};
  for (const [id, placement] of Object.entries(node.placements)) {
    if (present.has(id)) placements[id] = placement;
  }
  const entries = Object.entries(placements);
  const columns = Math.max(
    1,
    ...entries.map(([, placement]) => placement.column + (placement.columnSpan ?? 1)),
  );
  const rows = Math.max(
    1,
    ...entries.map(([, placement]) => placement.row + (placement.rowSpan ?? 1)),
  );
  const usedColumns = new Set<number>();
  const usedRows = new Set<number>();
  for (const [, placement] of entries) {
    for (let step = 0; step < (placement.columnSpan ?? 1); step++) {
      usedColumns.add(placement.column + step);
    }
    for (let step = 0; step < (placement.rowSpan ?? 1); step++) {
      usedRows.add(placement.row + step);
    }
  }
  const columnMap = new Map<number, number>();
  for (let column = 0; column < columns; column++) {
    if (usedColumns.has(column)) columnMap.set(column, columnMap.size);
  }
  const rowMap = new Map<number, number>();
  for (let row = 0; row < rows; row++) {
    if (usedRows.has(row)) rowMap.set(row, rowMap.size);
  }
  const nextColumns = Math.max(1, columnMap.size);
  const nextRows = Math.max(1, rowMap.size);
  const nextPlacements: Record<string, GridPlacement> = {};
  for (const [id, placement] of entries) {
    nextPlacements[id] = {
      ...placement,
      column: columnMap.get(placement.column) ?? 0,
      row: rowMap.get(placement.row) ?? 0,
    };
  }
  const nextMerged =
    node.merged === undefined
      ? undefined
      : Object.fromEntries(Object.entries(node.merged).filter(([id]) => present.has(id)));
  const keptMerged =
    nextMerged !== undefined && Object.keys(nextMerged).length > 0 ? nextMerged : undefined;
  const mapWeights = (
    weights: readonly number[] | undefined,
    map: ReadonlyMap<number, number>,
    count: number,
  ): readonly number[] | undefined => {
    if (weights === undefined) return undefined;
    return Array.from({ length: count }, (_, index) => {
      for (const [source, target] of map) {
        if (target === index) return weights[source] ?? 1;
      }
      return 1;
    });
  };
  const nextColumnWeights = mapWeights(node.columnWeights, columnMap, nextColumns);
  const nextRowWeights = mapWeights(node.rowWeights, rowMap, nextRows);
  const sameWeights = (
    left: readonly number[] | undefined,
    right: readonly number[] | undefined,
  ): boolean =>
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]));
  const samePlacements =
    Object.keys(nextPlacements).length === Object.keys(node.placements).length &&
    entries.every(([id, placement]) => {
      const old = node.placements?.[id];
      return (
        old !== undefined &&
        old.row === placement.row &&
        old.column === placement.column &&
        old.rowSpan === placement.rowSpan &&
        old.columnSpan === placement.columnSpan
      );
    });
  if (
    samePlacements &&
    nextRows === node.rows &&
    nextColumns === node.columns &&
    keptMerged === node.merged &&
    active === node.active &&
    sameWeights(nextColumnWeights, node.columnWeights) &&
    sameWeights(nextRowWeights, node.rowWeights)
  ) {
    return node;
  }
  const result = {
    ...node,
    rows: nextRows,
    columns: nextColumns,
    placements: nextPlacements,
    ...(nextColumnWeights === undefined ? {} : { columnWeights: nextColumnWeights }),
    ...(nextRowWeights === undefined ? {} : { rowWeights: nextRowWeights }),
    ...(keptMerged === undefined ? {} : { merged: keptMerged }),
    ...(active === undefined ? {} : { active }),
  };
  // Both are optional: a key that no longer has a referent must go too.
  if (keptMerged === undefined) delete result.merged;
  if (active === undefined) delete result.active;
  return result;
}

/**
 * Walk a tree and compact every grid in it.
 *
 * Persisted layout state is rehydrated as-is (the store engine does not validate
 * it), so a state written by a build that left a stale grid placement would
 * keep its blank track forever. Healing on load is what makes the fix reach a
 * person's existing layout instead of only newly-built ones.
 *
 * @param node - subtree root.
 * @returns the same node when every grid is already tight, a new node otherwise.
 */
export function normalizeGrids(node: LayoutNode): LayoutNode {
  if (node.type === "region") {
    const existing = node.children;
    if (existing === undefined) return node;
    const children = existing.map(normalizeGrids);
    return children.every((child, index) => child === existing[index])
      ? node
      : { ...node, children };
  }
  const children = node.children.map(normalizeGrids);
  const unchanged = children.every((child, index) => child === node.children[index]);
  if (node.type === "grid") return compactGrid(unchanged ? node : { ...node, children });
  return unchanged ? node : { ...node, children };
}

/**
 * Re-home visible views whose recorded window group no longer exists.
 *
 * The tree is not the only place a removed region leaves a reference: the view
 * table names its region directly. A visible view pointing at a missing region
 * renders nowhere while still counting as placed, so callers keep re-placing it
 * and get the same dead record back — the reason a window (the conversation is
 * the common one) can disappear for good after its group is removed. Hidden
 * views are left alone: they are not on screen, and `place` overwrites the
 * region the next time one is shown.
 *
 * @param state - the state to reconcile.
 * @returns the same state when every visible view has a live region, a new state otherwise.
 */
export function normalizeViews(state: LayoutState): LayoutState {
  const fallback = firstWindowGroupRegion(state.tree);
  if (fallback === undefined) return state;
  let changed = false;
  const views: Record<string, ViewRecord> = {};
  for (const [id, record] of Object.entries(state.views)) {
    if (record.hidden !== true && findRegion(state.tree, record.region) === null) {
      views[id] = { ...record, region: fallback };
      changed = true;
    } else {
      views[id] = record;
    }
  }
  return changed ? { ...state, views } : state;
}

/**
 * Swap two grid cells' placements. The views stay where they are; only their
 * cells swap.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param cellId - the dragged cell.
 * @param targetId - the cell it was dropped on.
 * @returns the tree, or the same tree when either cell is unknown.
 */
export function moveGridCell(
  tree: LayoutNode,
  gridId: string,
  cellId: string,
  targetId: string,
): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid" || cellId === targetId) return tree;
  const placements = gridPlacements(grid);
  const source = placements[cellId];
  const target = placements[targetId];
  if (source === undefined || target === undefined) return tree;
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? compactGrid({
          ...node,
          placements: { ...placements, [cellId]: target, [targetId]: source },
        })
      : node,
  );
}

/**
 * Resize one cell's span. A span that would overlap another cell is refused.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param cellId - the cell to resize.
 * @param rowSpan - requested rows (at least 1).
 * @param columnSpan - requested columns (at least 1).
 * @returns the tree, or the same tree for an unknown cell or an overlap.
 */
export function resizeGridCell(
  tree: LayoutNode,
  gridId: string,
  cellId: string,
  rowSpan: number,
  columnSpan: number,
): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid") return tree;
  const placements = gridPlacements(grid);
  const source = placements[cellId];
  if (source === undefined) return tree;
  const next: GridPlacement = {
    ...source,
    rowSpan: Math.max(1, Math.round(rowSpan)),
    columnSpan: Math.max(1, Math.round(columnSpan)),
  };
  const overlaps = Object.entries(placements).some(([id, placement]) => {
    if (id === cellId) return false;
    return (
      next.row < placement.row + (placement.rowSpan ?? 1) &&
      next.row + (next.rowSpan ?? 1) > placement.row &&
      next.column < placement.column + (placement.columnSpan ?? 1) &&
      next.column + (next.columnSpan ?? 1) > placement.column
    );
  });
  if (overlaps) return tree;
  const all = { ...placements, [cellId]: next };
  const columns = Math.max(
    grid.columns,
    ...Object.values(all).map((placement) => placement.column + (placement.columnSpan ?? 1)),
  );
  const rows = Math.max(
    grid.rows,
    ...Object.values(all).map((placement) => placement.row + (placement.rowSpan ?? 1)),
  );
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? { ...node, rows, columns, placements: { ...placements, [cellId]: next } }
      : node,
  );
}

/**
 * Merge two adjacent grid cells into one cell.
 *
 * The two cells' regions are kept: the target cell becomes a split holding both
 * (the source region is no longer a grid child, but its views stay placed), and
 * the target placement grows to the union rectangle. Non-adjacent cells, or a
 * union that would overlap a third cell, are refused.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param sourceId - the cell to fold into the target.
 * @param targetId - the cell that survives.
 * @returns the tree, or the same tree when the merge is not legal.
 */
export function mergeGridCells(
  tree: LayoutNode,
  gridId: string,
  sourceId: string,
  targetId: string,
): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid" || sourceId === targetId) return tree;
  const placements = gridPlacements(grid);
  const source = placements[sourceId];
  const target = placements[targetId];
  if (source === undefined || target === undefined) return tree;
  const row = Math.min(source.row, target.row);
  const column = Math.min(source.column, target.column);
  const rowSpan =
    Math.max(source.row + (source.rowSpan ?? 1), target.row + (target.rowSpan ?? 1)) - row;
  const columnSpan =
    Math.max(source.column + (source.columnSpan ?? 1), target.column + (target.columnSpan ?? 1)) -
    column;
  // Adjacency: the union adds no gap and the rectangles touch.
  const sourceArea = (source.rowSpan ?? 1) * (source.columnSpan ?? 1);
  const targetArea = (target.rowSpan ?? 1) * (target.columnSpan ?? 1);
  const touches =
    rowSpan * columnSpan === sourceArea + targetArea &&
    (source.row === target.row || source.column === target.column);
  if (!touches) return tree;
  const overlaps = Object.entries(placements).some(([id, placement]) => {
    if (id === sourceId || id === targetId) return false;
    return (
      row < placement.row + (placement.rowSpan ?? 1) &&
      row + rowSpan > placement.row &&
      column < placement.column + (placement.columnSpan ?? 1) &&
      column + columnSpan > placement.column
    );
  });
  if (overlaps) return tree;

  const sourceNode = grid.children.find((child) => child.id === sourceId);
  const targetNode = grid.children.find((child) => child.id === targetId);
  if (sourceNode === undefined || targetNode === undefined) return tree;
  const dir: Dir = source.row === target.row ? "row" : "column";
  const before = dir === "row" ? source.column < target.column : source.row < target.row;
  const split: SplitNode = {
    type: "split",
    id: `merge:${gridId}:${targetId}:${sourceId}`,
    dir,
    children: before ? [sourceNode, targetNode] : [targetNode, sourceNode],
  };
  const children = grid.children
    .filter((child) => child.id !== sourceId)
    .map((child) => (child.id === targetId ? split : child));
  const nextPlacements = { ...placements };
  delete nextPlacements[sourceId];
  delete nextPlacements[targetId];
  nextPlacements[split.id] = { ...target, row, column, rowSpan, columnSpan };
  const rows = Math.max(
    1,
    ...Object.values(nextPlacements).map((placement) => placement.row + (placement.rowSpan ?? 1)),
  );
  const columns = Math.max(
    1,
    ...Object.values(nextPlacements).map(
      (placement) => placement.column + (placement.columnSpan ?? 1),
    ),
  );
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? compactGrid({
          ...node,
          rows,
          columns,
          children,
          placements: nextPlacements,
          merged: { ...node.merged, [split.id]: { source, target } },
        })
      : node,
  );
}

/**
 * Split a merged grid cell back into the cells its split holds.
 *
 * The inverse of {@link mergeGridCells}: a split child becomes its children, and
 * each child receives a slice of the merged cell's rectangle along the split's
 * axis. Only splits (not ordinary regions) are candidates.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param cellId - the split cell to unmerge.
 * @returns the tree, or the same tree when the cell is not a split.
 */
export function unmergeGridCell(tree: LayoutNode, gridId: string, cellId: string): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid") return tree;
  const cell = grid.children.find((child) => child.id === cellId);
  if (cell === undefined || cell.type !== "split" || cell.children.length < 2) return tree;
  const placements = gridPlacements(grid);
  const target = placements[cellId];
  if (target === undefined) return tree;
  const pieces = cell.children.length;
  const nextPlacements = { ...placements };
  delete nextPlacements[cellId];
  const merged = grid.merged?.[cellId];
  if (merged !== undefined) {
    nextPlacements[cell.children[0]!.id] = merged.source;
    nextPlacements[cell.children[1]!.id] = merged.target;
  } else
    cell.children.forEach((child, index) => {
      if (cell.dir === "row") {
        const width = Math.max(1, Math.floor((target.columnSpan ?? 1) / pieces));
        nextPlacements[child.id] = {
          row: target.row,
          column: target.column + width * index,
          rowSpan: target.rowSpan ?? 1,
          columnSpan: index === pieces - 1 ? (target.columnSpan ?? pieces) - width * index : width,
        };
      } else {
        const height = Math.max(1, Math.floor((target.rowSpan ?? 1) / pieces));
        nextPlacements[child.id] = {
          row: target.row + height * index,
          column: target.column,
          rowSpan: index === pieces - 1 ? (target.rowSpan ?? pieces) - height * index : height,
          columnSpan: target.columnSpan ?? 1,
        };
      }
    });
  const children = grid.children.flatMap((child) =>
    child.id === cellId ? cell.children : [child],
  );
  const nextMerged = { ...grid.merged };
  delete nextMerged[cellId];
  const rows = Math.max(
    1,
    ...Object.values(nextPlacements).map((placement) => placement.row + (placement.rowSpan ?? 1)),
  );
  const columns = Math.max(
    1,
    ...Object.values(nextPlacements).map(
      (placement) => placement.column + (placement.columnSpan ?? 1),
    ),
  );
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? compactGrid({
          ...node,
          rows,
          columns,
          children,
          placements: nextPlacements,
          ...(Object.keys(nextMerged).length === 0 ? {} : { merged: nextMerged }),
        })
      : node,
  );
}

/**
 * Set one grid track's relative weight.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param axis - column or row.
 * @param index - zero-based track.
 * @param weight - positive relative weight.
 * @returns the tree, or the same tree for an unknown grid/track.
 */
export function setGridTrackWeight(
  tree: LayoutNode,
  gridId: string,
  axis: "column" | "row",
  index: number,
  weight: number,
): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid") return tree;
  const count =
    axis === "column"
      ? gridShape(grid, grid.children.length).columns
      : gridShape(grid, grid.children.length).rows;
  if (index < 0 || index >= count) return tree;
  const weights = gridTrackWeights(grid, axis, count);
  weights[index] = Math.max(0.05, weight);
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? { ...node, [axis === "column" ? "columnWeights" : "rowWeights"]: weights }
      : node,
  );
}

/**
 * Drag a boundary between two grid tracks by `delta` pixels.
 *
 * @param tree - the tree to update.
 * @param gridId - the grid.
 * @param axis - column or row.
 * @param boundary - zero-based track to grow; the next track gives way.
 * @param delta - pointer movement along the axis, in pixels.
 * @param extent - the grid's pixel extent along the axis.
 * @returns the tree, or the same tree for an edge/unknown boundary.
 */
export function resizeGridTrack(
  tree: LayoutNode,
  gridId: string,
  axis: "column" | "row",
  boundary: number,
  delta: number,
  extent: number,
): LayoutNode {
  const grid = findNode(tree, gridId);
  if (grid === null || grid.type !== "grid" || extent <= 0) return tree;
  const shape = gridShape(grid, grid.children.length);
  const count = axis === "column" ? shape.columns : shape.rows;
  if (boundary < 0 || boundary >= count - 1) return tree;
  const weights = gridTrackWeights(grid, axis, count);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const deltaWeight = (delta / extent) * total;
  const left = weights[boundary] ?? 1;
  const right = weights[boundary + 1] ?? 1;
  const move = Math.max(-(left - 0.05), Math.min(right - 0.05, deltaWeight));
  if (Math.abs(move) < 1e-6) return tree;
  weights[boundary] = left + move;
  weights[boundary + 1] = right - move;
  return replaceNode(tree, gridId, (node) =>
    node.type === "grid"
      ? { ...node, [axis === "column" ? "columnWeights" : "rowWeights"]: weights }
      : node,
  );
}

export function resolveSizes(state: LayoutState, width: number, height: number): Map<string, Box> {
  const out = new Map<string, Box>();
  const visit = (node: LayoutNode, w: number, h: number): void => {
    if (node.type === "region") {
      out.set(node.id, { width: w, height: h });
      // A selector region hands its child the box **minus the bar it draws** when it shows one: the
      // bar is real pixels (the frame draws it as soon as there are two children to choose between),
      // and a stack drawn from the allocation would otherwise overflow its container by that much.
      // A rail selector is **outside** the region, and `none` draws nothing, so neither reserves.
      const child = activeChild(state, node);
      if (child !== null) {
        const bar = drawsRegionBar(node) ? HEADER_HEIGHT : 0;
        visit(child, w, Math.max(0, h - bar));
      }
      return;
    }
    if (node.type === "grid") {
      out.set(node.id, { width: w, height: h });
      const cells = node.children.filter((child) => isPresent(state, child));
      const { columns, rows } = gridShape(node, cells.length);
      const columnWeights = gridTrackWeights(node, "column", columns);
      const rowWeights = gridTrackWeights(node, "row", rows);
      const columnTotal = columnWeights.reduce((sum, value) => sum + value, 0);
      const rowTotal = rowWeights.reduce((sum, value) => sum + value, 0);
      cells.forEach((child, index) => {
        const placement = node.placements?.[child.id] ?? {
          row: Math.floor(index / columns),
          column: index % columns,
        };
        const columnSpan = placement.columnSpan ?? 1;
        const rowSpan = placement.rowSpan ?? 1;
        const columnWidth = columnWeights
          .slice(placement.column, placement.column + columnSpan)
          .reduce((sum, value) => sum + value, 0);
        const rowHeight = rowWeights
          .slice(placement.row, placement.row + rowSpan)
          .reduce((sum, value) => sum + value, 0);
        visit(child, (w * columnWidth) / columnTotal, (h * rowHeight) / rowTotal);
      });
      return;
    }
    out.set(node.id, { width: w, height: h });
    const present = node.children.filter((child) => isPresent(state, child));
    // Sashes overlay the boundary (no flex item), so the regions share the whole extent.
    const content = Math.max(0, node.dir === "row" ? w : h);
    const basis = present.map(nodeBasis);
    const sizes = isStackSplit(node, present)
      ? allocateStack(
          basis,
          content,
          present.map((child) => child.type === "region" && child.collapsed === true),
          STACK_HEADER_HEIGHT,
        )
      : allocateContent(basis, content);
    present.forEach((child, index) => {
      const main = sizes[index] ?? 0;
      if (node.dir === "row") visit(child, main, h);
      else visit(child, w, main);
    });
  };
  visit(state.tree, width, height);
  return out;
}

// ── collapse & split ──────────────────────────────────────────────────

/**
 * A block a drag may take away (VS Code's sash snap, `splitview.ts:937-957`).
 *
 * The threshold is the block's **own** extent: the drag computes what the block would be left with,
 * and it goes away once that is under half its minimum, coming back once the drag brings it over
 * again. The two limits differ by the block's minimum — that band is what keeps the flip from
 * chattering — and `size` is the extent it had when the drag started, which is what it returns to.
 */
export interface SnapTarget {
  readonly id: string;
  readonly hidden: boolean;
  /** Which side of the boundary it is on: the space it takes grows with a positive / negative drag. */
  readonly side: "before" | "after";
  /** Half its own minimum: the threshold it flips across. */
  readonly half: number;
  /** The extent it had when the drag started. */
  readonly size: number;
}

/** The extent a list of children is drawn at, preferring what the caller measured. */
const extentOf = (child: LayoutNode, drawn?: ReadonlyMap<string, number>): number =>
  drawn?.get(child.id) ?? nodeBasis(child).size;

/**
 * Which block on each side of a boundary a drag may take away.
 *
 * The candidate is the nearest **visible** block that opted in (`snap: true`), or — when none on that
 * side is visible — the nearest hidden one, so a block that went away can be brought back by the same
 * gesture.
 *
 * @param state - the layout state.
 * @param splitId - the split whose boundary is being dragged.
 * @param index - the boundary's position (the child **after** it, as the frame numbers sashes).
 * @param drawn - the extents on screen, when the caller knows them.
 * @returns the targets, if either side has one.
 */
export function snapTargets(
  state: LayoutState,
  splitId: string,
  index: number,
  drawn?: ReadonlyMap<string, number>,
): { before?: SnapTarget; after?: SnapTarget } {
  const node = findNode(state.tree, splitId);
  if (node === null || node.type !== "split") return {};
  const present = node.children.filter((child) => isPresent(state, child));
  if (index < 1 || index >= present.length) return {};
  const candidate = (list: readonly LayoutNode[]): RegionNode | undefined => {
    const willing = list.filter(
      (child): child is RegionNode => child.type === "region" && child.snap === true,
    );
    return (
      willing.find((child) => child.collapsed !== true) ??
      willing.find((child) => child.collapsed === true)
    );
  };
  const target = (
    region: RegionNode | undefined,
    side: "before" | "after",
  ): SnapTarget | undefined =>
    region === undefined
      ? undefined
      : {
          id: region.id,
          hidden: region.collapsed === true,
          side,
          half: Math.floor(region.min / 2),
          size: extentOf(region, drawn),
        };
  const before = target(candidate(present.slice(0, index).reverse()), "before");
  const after = target(candidate(present.slice(index)), "after");
  return { ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) };
}

/**
 * Give every block of a split the same extent.
 *
 * This is the last of the three answers VS Code gives a sash reset (`grid.ts:714`): a block with a
 * size it prefers gets that, and failing both sides, the split's blocks share what there is evenly.
 *
 * @param state - the layout state.
 * @param splitId - the split to even out.
 * @param drawn - the extents on screen, when the caller knows them.
 * @returns the state, or the same state when nothing moved.
 */
export function distributeSplitEvenly(
  state: LayoutState,
  splitId: string,
  drawn?: ReadonlyMap<string, number>,
): LayoutState {
  const node = findNode(state.tree, splitId);
  if (node === null || node.type !== "split") return state;
  const present = node.children.filter((child) => isPresent(state, child));
  const content = present.reduce((total, child) => total + extentOf(child, drawn), 0);
  if (present.length === 0 || content <= 0) return state;
  const even = content / present.length;
  const sizes = allocateContent(
    present.map((child) => ({ ...nodeBasis(child), flex: true, size: even })),
    content,
  );
  let tree = state.tree;
  present.forEach((child, at) => {
    tree = setNodeSize(tree, child.id, sizes[at] ?? even);
  });
  return tree === state.tree ? state : { ...state, tree };
}

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
  remember?: number,
): LayoutState {
  const node = findRegion(state.tree, regionId);
  if (!node || node.collapsed === collapsed) return state;
  const tree = updateRegion(state.tree, regionId, (target) =>
    collapsed
      ? {
          ...target,
          collapsed: true,
          // What to come back to: the size the caller names (a drag remembers the extent the block
          // had when the drag started, VS Code's `snapBefore.size`), else what it has now.
          cachedSize:
            remember !== undefined && remember > 0
              ? Math.round(remember)
              : target.size > 0
                ? target.size
                : target.cachedSize,
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
/** One step on the way from the root to a region. */
interface RegionAncestryStep {
  readonly parent: SplitNode | GridNode;
  readonly index: number;
}

/**
 * The path from the root down to a region, outermost first.
 *
 * @param tree - the node to search.
 * @param regionId - the region to find.
 * @returns the steps, or undefined when the region is not in this subtree.
 */
function regionAncestry(tree: LayoutNode, regionId: string): RegionAncestryStep[] | undefined {
  if (tree.type === "region") return tree.id === regionId ? [] : undefined;
  for (let index = 0; index < tree.children.length; index += 1) {
    const below = regionAncestry(tree.children[index], regionId);
    if (below !== undefined) return [{ parent: tree, index }, ...below];
  }
  return undefined;
}

/**
 * The region a subtree shows nearest one of its edges.
 *
 * @param node - the subtree.
 * @param edge - which edge.
 * @returns the region id at that edge.
 */
function edgeRegionId(node: LayoutNode, edge: "first" | "last"): string {
  if (node.type === "region") return node.id;
  const children = edge === "first" ? node.children : [...node.children].reverse();
  return edgeRegionId(children[0], edge);
}

/**
 * The region adjacent to another one in a direction, from the tree's own geometry.
 *
 * A directional `findGroup` (LEFT/RIGHT/UP/DOWN) can only be answered where the tree is: walk
 * up from the source region to the nearest ancestor split on that direction's axis which has a
 * sibling on that side, then down that sibling to the region nearest the shared edge. A nearer
 * ancestor without such a sibling does not answer, so the walk continues upward — the
 * neighbour may be an uncle's child.
 *
 * @param tree - the tree to search.
 * @param regionId - the region to look from.
 * @param side - the direction to look in.
 * @returns the neighbouring region's id, or undefined when there is none.
 */
export function regionInDirection(
  tree: LayoutNode,
  regionId: string,
  side: Side,
): string | undefined {
  const path = regionAncestry(tree, regionId);
  if (path === undefined) return undefined;
  const { dir, before } = sideGeometry(side);
  for (let step = path.length - 1; step >= 0; step -= 1) {
    const { parent, index } = path[step];
    if (parent.type === "grid") {
      const columns = Math.max(1, parent.columns);
      const row = Math.floor(index / columns);
      const column = index % columns;
      const nextRow = row + (side === "up" ? -1 : side === "down" ? 1 : 0);
      const nextColumn = column + (side === "left" ? -1 : side === "right" ? 1 : 0);
      if (nextRow < 0 || nextColumn < 0 || nextRow >= parent.rows || nextColumn >= columns) {
        continue;
      }
      const neighbour = parent.children[nextRow * columns + nextColumn];
      if (neighbour === undefined) continue;
      return edgeRegionId(neighbour, side === "left" || side === "up" ? "last" : "first");
    }
    if (parent.type !== "split" || parent.dir !== dir) continue;
    const neighbour = parent.children[index + (before ? -1 : 1)];
    if (neighbour === undefined) continue;
    return edgeRegionId(neighbour, before ? "last" : "first");
  }
  return undefined;
}

export function splitRegionWith(
  state: LayoutState,
  regionId: string,
  side: Side,
  splitId: string,
  newRegionId: string,
  options?: { embedder?: boolean; gridCells?: boolean },
): LayoutState {
  // The id may name a **split** now (a stack takes the region's place), and splitting *it* is what a
  // caller means: the new pane lands beside the whole stack, not between two of its rows.
  const node = findNode(state.tree, regionId);
  if (node === null) return state;
  const tabs = node.type === "region" ? node.tabs : undefined;
  const { dir, before } = sideGeometry(side);
  const fresh = regionNode(newRegionId, 0, {
    flex: true,
    min: DEFAULT_MIN,
    // A split is a second area of the **same kind**: it shows the chrome the region it
    // came from shows. The centre carries `tabs: "multiple"`, so a region split off it
    // has a tab strip for the views it holds — which is what a person expects of an
    // editor group they just created.
    ...(tabs === undefined ? {} : { tabs }),
    // Only the embedder's own splits carry the mark: a region the app made for a **view** is
    // the app's shape and must survive being empty (its view may not be placed yet).
    ...(options?.embedder === true ? { embedder: true } : {}),
  });
  if (options?.gridCells === true) {
    const ancestry = regionAncestry(state.tree, regionId);
    const parent = ancestry?.[ancestry.length - 1];
    if (parent !== undefined && parent.parent.type === "grid") {
      const grid = parent.parent;
      const shape = gridShape(grid, grid.children.length);
      const placements = new Map<string, GridPlacement>();
      grid.children.forEach((child, index) => {
        placements.set(
          child.id,
          grid.placements?.[child.id] ?? {
            row: Math.floor(index / shape.columns),
            column: index % shape.columns,
          },
        );
      });
      const source = placements.get(regionId) ?? { row: 0, column: 0 };
      const horizontal = side === "left" || side === "right";
      const at = horizontal
        ? side === "left"
          ? source.column
          : source.column + (source.columnSpan ?? 1)
        : side === "up"
          ? source.row
          : source.row + (source.rowSpan ?? 1);
      // Make room by shifting the cells at/after the insertion line. The grid
      // grows to its content; it is not a fixed 2×2 board.
      for (const [id, placement] of placements) {
        if (horizontal) {
          if (placement.column >= at) {
            placements.set(id, { ...placement, column: placement.column + 1 });
          }
        } else if (placement.row >= at) {
          placements.set(id, { ...placement, row: placement.row + 1 });
        }
      }
      placements.set(
        newRegionId,
        horizontal ? { row: source.row, column: at } : { row: at, column: source.column },
      );
      const columns = Math.max(
        1,
        ...[...placements.values()].map(
          (placement) => placement.column + (placement.columnSpan ?? 1),
        ),
      );
      const rows = Math.max(
        1,
        ...[...placements.values()].map((placement) => placement.row + (placement.rowSpan ?? 1)),
      );
      const children = [...grid.children];
      children.splice(before ? parent.index : parent.index + 1, 0, fresh);
      return {
        ...state,
        tree: replaceNode(state.tree, grid.id, () => ({
          ...grid,
          rows,
          columns,
          children,
          placements: Object.fromEntries(placements),
        })),
      };
    }
  }

  const replacement: SplitNode = {
    type: "split",
    id: splitId,
    dir,
    // The node that used to sit here is now a child, so its name moves up to the split that replaced
    // it — callers that address the id (a bar listing this region's children) still get the name.
    ...(node.label === undefined ? {} : { label: node.label }),
    children: before ? [fresh, node] : [node, fresh],
  };
  return { ...state, tree: replaceNode(state.tree, regionId, () => replacement) };
}

/**
 * Remove a region from the tree, the inverse of {@link splitRegionWith}.
 *
 * The frame **owns** the tree, so the only thing that may ask for this is the embedder telling
 * it a group is gone (a closed editor group, an emptied side). Two rules keep the result a
 * well-formed tree: a split that still holds two children keeps them, and a split left with a
 * single child **collapses into it** — a split of one is not a split, and the survivor has to
 * fill the place (a survivor configured as a fixed-size child of the split would otherwise
 * size itself to nothing as a direct child of the grandparent).
 *
 * Which regions **may** go is the caller's decision — the embedder keeps the last one because
 * something has to hold the screen. Views that lived in the removed region are the caller's to
 * drop; this function only edits the tree.
 *
 * @param state - the layout state.
 * @param regionId - the region to remove.
 * @returns the state, or the same state when there is nothing to remove.
 */
export function removeRegion(state: LayoutState, regionId: string): LayoutState {
  const path = regionAncestry(state.tree, regionId);
  // No entry means the id names no region (the tree's own root is a split, not a region).
  if (path === undefined || path.length === 0) return state;
  const step = path[path.length - 1];
  if (step === undefined) return state;
  const remaining = step.parent.children.filter((_, position) => position !== step.index);
  // A grid can lose its last cell (the stage is allowed to be empty); a split cannot.
  if (remaining.length === 0) {
    if (step.parent.type === "grid") {
      const grid = step.parent;
      return {
        ...state,
        tree: replaceNode(state.tree, grid.id, () => compactGrid({ ...grid, children: [] })),
      };
    }
    return state;
  }
  const survivor = remaining[0];
  const replacement: LayoutNode =
    step.parent.type === "grid"
      ? compactGrid({ ...step.parent, children: remaining })
      : remaining.length === 1
        ? survivor.type === "region"
          ? { ...survivor, flex: true }
          : survivor
        : { ...step.parent, children: remaining };
  return { ...state, tree: replaceNode(state.tree, step.parent.id, () => replacement) };
}

/**
 * Drop the regions the embedder left behind.
 *
 * A **marked** region (see {@link RegionNode.embedder}) is an editor group's home, and a group
 * is removed when its last editor closes — so a marked region with nothing in it is the
 * leftover of a session whose files are gone, with no group to close and no chrome on screen to
 * close it with. Unmarked regions are the app's own shape and are never pruned, however empty
 * they look while their views are still being placed.
 *
 * @param state - the layout state.
 * @returns the state with the left-over regions removed.
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
  // Deepest first: removing a child can collapse the split its parent sat in.
  for (const id of stale.reverse()) next = removeRegion(next, id);
  return next;
}

/**
 * A folded entry's height: its header and nothing else.
 *
 * Fixed in the header's own style so the allocation subtracts it exactly instead of guessing.
 */
export const HEADER_HEIGHT = 20;

/**
 * The height of a stack row's header.
 *
 * A stack row mirrors the view's own pane header (VS Code's is 22), while the
 * selector bar and tab strip keep {@link HEADER_HEIGHT}. The two are separate so
 * a stack row can align with what the view draws without moving the other chrome.
 */
export const STACK_HEADER_HEIGHT = 22;

/**
 * Smallest height a stack entry may be dragged to.
 *
 * An entry is hidden by **folding** it, not by dragging it away, so the floor only has to keep
 * the header and a sliver of content reachable.
 */
export const MIN_ENTRY = 48;

/**
 * What every entry of a stack becomes when one entry is dragged to `target`.
 *
 * The delta goes to the sash's own view first, then to the views **above** it (nearest first), and
 * the views **below** give up the same delta (nearest first, each clamped at its floor) — upstream's
 * loops from `SplitView.resize` (`splitview.ts:1308-1325`). How far the boundary may travel is
 * upstream's `maxDelta` (`:1281`), and it counts the room the entries **below** have: nothing above
 * the dragged entry is ever taken from (measured: doing that made a drag eat the entries above, and
 * the person read it as "贴底的连续折叠是不会动的"). A folded entry is a header — it owns no room
 * and is left out of the result entirely, so a drag can never write over the size it was folded
 * with.
 *
 * @param entries - every entry of the stack, top-down, with its height and fold state.
 * @param viewId - the entry whose bottom edge is being dragged.
 * @param target - the height it is being dragged to.
 * @returns the new height of every entry the drag touches (folded entries are absent).
 */
export function redistributeOnDrag(
  entries: readonly { viewId: string; height: number; folded: boolean }[],
  viewId: string,
  target: number,
): Map<string, number> {
  const open = entries.filter((entry) => !entry.folded);
  const sizes = new Map(open.map((entry) => [entry.viewId, entry.height]));
  const at = open.findIndex((entry) => entry.viewId === viewId);
  const dragged = open[at];
  if (dragged === undefined) return sizes;
  const room = (entry: { height: number }): number => Math.max(0, entry.height - MIN_ENTRY);
  const up = open.slice(0, at);
  const down = open.slice(at + 1);
  const maxDelta = down.reduce((total, entry) => total + room(entry), 0);
  const minDelta = -[...up, ...down].reduce((total, entry) => total + room(entry), 0);
  const delta = Math.max(
    minDelta,
    Math.min(maxDelta, Math.max(MIN_ENTRY, target) - dragged.height),
  );
  if (delta !== 0) {
    let deltaUp = delta;
    for (const entry of [dragged, ...up.slice().reverse()]) {
      const size = Math.max(MIN_ENTRY, entry.height + deltaUp);
      deltaUp -= size - entry.height;
      sizes.set(entry.viewId, size);
    }
    let deltaDown = delta;
    for (const entry of down) {
      const size = Math.max(MIN_ENTRY, entry.height - deltaDown);
      deltaDown += size - entry.height;
      sizes.set(entry.viewId, size);
    }
  }
  // Hand back **only the entries that really move**. Everything else was in `sizes` at the height
  // it is drawn at, which is not always the height in the layout (the allocation re-fits the stack,
  // so a drawn 199 can sit next to a stored 200) — writing those back rewrote entries the drag
  // never touched, and the entries above a drag drifted every time it ran (measured).
  for (const entry of entries) {
    if (sizes.get(entry.viewId) === entry.height) sizes.delete(entry.viewId);
  }
  return sizes;
}

/**
 * The height an **Alt-drag** takes a row to (design B6, `SplitView.onSashStart`'s alt branch).
 *
 * Alt narrows the drag to the view on the far side of the boundary, at **half** its own headroom:
 * the last boundary uses the upper (dragged) view, `(min − size)/2` on the way in; every other
 * boundary uses the next view, `(size − min)/2` on the way out. With no declared ceiling the other
 * direction is unbounded, exactly as upstream's `maximumSize` is (the stack's rows declare none).
 * The result is the **dragged row's height**; the frame clamps it to the stack and hands it to
 * `redistributeOnDrag`.
 *
 * @param entries - the stack's rows, top-down, with the heights they are drawn at.
 * @param viewId - the row whose bottom edge is being dragged.
 * @param target - the unconstrained height the pointer asks for.
 * @returns the Alt-constrained height for that row.
 */
export function altDragTarget(
  entries: readonly { viewId: string; height: number; folded: boolean }[],
  viewId: string,
  target: number,
): number {
  const at = entries.findIndex((entry) => entry.viewId === viewId);
  const dragged = entries[at];
  if (dragged === undefined || dragged.folded || at >= entries.length - 1) return target;
  const last = at === entries.length - 2;
  // A folded row between the anchor and the next open row is a header: skip it, like the drag's
  // own `redistributeOnDrag` does.
  const focus = last ? dragged : entries.slice(at + 1).find((entry) => !entry.folded);
  if (focus === undefined) return target;
  const minDelta = last ? (MIN_ENTRY - dragged.height) / 2 : Number.NEGATIVE_INFINITY;
  const maxDelta = last ? Number.POSITIVE_INFINITY : (focus.height - MIN_ENTRY) / 2;
  const delta = Math.max(minDelta, Math.min(maxDelta, target - dragged.height));
  return dragged.height + delta;
}

/**
 * What a **double-click on a boundary** does: even out the two rows it separates.
 *
 * Upstream's `SplitView` fires `onDidReset` for the sash (`splitview.ts:1186`) and names the row it
 * would work with by looking outward for the first **snap** view, skipping folded ones
 * (`findFirstSnapIndex`, `:1454-1461`). It then refuses outright when that row is hidden
 * (`:1193-1199`) — a folded row is a header and has no height to even out. This keeps the same
 * shape: find the nearest row above and the nearest row below that are **both unfolded**, and give
 * the pair the same height (their average, never under the floor). Anything else resets nothing.
 *
 * @param entries - the stack's rows, in visual order, with the heights they are drawn at.
 * @param viewId - the row whose bottom edge was double-clicked.
 * @returns the new heights for the pair, or an empty list when there is nothing to even out.
 */
export function resetStackBoundary(
  entries: readonly { viewId: string; height: number; folded: boolean }[],
  viewId: string,
): { viewId: string; height: number }[] {
  const at = entries.findIndex((entry) => entry.viewId === viewId);
  if (at < 0) return [];
  // Upstream searches outward **from the boundary's own row** (`range(index, -1)` / `range(index+1,…)`,
  // `:1187-1188`) and only refuses when a whole side is folded (`:1193-1199`).
  const above = entries.slice(0, at + 1).findLast((entry) => !entry.folded);
  const below = entries.slice(at + 1).find((entry) => !entry.folded);
  if (above === undefined || below === undefined) return [];
  const even = Math.max(MIN_ENTRY, Math.round((above.height + below.height) / 2));
  return [
    { viewId: above.viewId, height: even },
    { viewId: below.viewId, height: even },
  ];
}

/**
 * The entry regions of a stack split, in order.
 *
 * @param node - the subtree to look in.
 * @returns the leaves the normalizer made (empty for anything that is not a stack split).
 */
/**
 * The split that holds this id as its child, if any.
 *
 * @param node - the subtree to search.
 * @param id - the child to find.
 * @returns the parent split, or null.
 */
/**
 * The region a view's home belongs to for **structure**.
 *
 * A stack row is a leaf that exists to hold one view; an operation that splits or moves a region
 * addresses the region the row stands for — the split that took the region's id. Without this a
 * "split beside me" lands *inside* the stack, between two rows.
 *
 * @param tree - the tree to look in.
 * @param regionId - the view's region, possibly a row.
 * @returns the region to address.
 */
export function structuralRegion(tree: LayoutNode, regionId: string): string {
  const parent = findParentSplit(tree, regionId);
  if (parent !== null && regionId.startsWith(`${parent.id}/stack/`)) return parent.id;
  return regionId;
}

export function findParentSplit(node: LayoutNode, id: string): SplitNode | null {
  const children = node.children ?? [];
  if (node.type === "split" && children.some((child) => child.id === id)) return node;
  // Regions have children too (the container layer), and a split may live anywhere under one — so the
  // search goes through **both** kinds of node, not just splits.
  for (const child of children) {
    const hit = findParentSplit(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** The four states VS Code gives a sash (`SashState`), in its own words. */
export type EntrySashState = "enabled" | "at-minimum" | "at-maximum" | "disabled";

/**
 * The `SashState` of the boundary **under** a stack row (design B2/B4).
 *
 * A drag is possible in a direction only when the two **sides** can trade room:
 * down/right needs the rows above to grow and the rows below to shrink; up/left needs the opposite.
 * The tests are cumulative and skip folded rows (B3). At least one direction ⇒ the sash is
 * `enabled` or one of the one-way states; neither ⇒ `disabled`. The **last** row has no boundary
 * (B7), and a side that is entirely folded has no movable row at all.
 *
 * `drawn` is what the rows are actually painted at, when the caller knows it (a flexible row's
 * tree `size` is 0, so the claim alone cannot answer B2); without it the tree's own sizes are used.
 *
 * @param state - the layout state.
 * @param rowId - the row whose bottom edge is in question.
 * @param drawn - row id → painted height, when known.
 * @returns the sash state under that row.
 */
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
  // Does the sash have room to move down/right (up grows, down shrinks) or up/left?
  const downOk = canGrow(up) && canShrink(down);
  const upOk = canShrink(up) && canGrow(down);
  if (!upOk && !downOk) return "disabled";
  if (upOk && downOk) return "enabled";
  // AtMinimum can still move down/right; AtMaximum can still move up/left (upstream `SashState`).
  return downOk ? "at-minimum" : "at-maximum";
}

/**
 * Whether the boundary under a stack row can move in any direction.
 *
 * @param state - the layout state.
 * @param rowId - the row whose bottom edge is in question.
 * @param drawn - row id → painted height, when known.
 * @returns true when the sash is not `disabled`.
 */
export function entryBoundary(
  state: LayoutState,
  rowId: string,
  drawn?: ReadonlyMap<string, number>,
): boolean {
  return entrySashState(state, rowId, drawn) !== "disabled";
}

/**
 * The row a boundary drag actually resizes.
 *
 * A folded row is a header: it owns no room, so dragging the boundary under it cannot resize *it*.
 * The rows above the boundary are still open, though — the nearest one is the row whose height
 * changes, and the folded header (plus whatever sits below it) moves with it. Without this, a sash
 * next to a folded view looked enabled but every move was a no-op (the `redistributeOnDrag` anchor
 * was the folded row).
 *
 * @param rows - the stack's rows, top-down.
 * @param viewId - the row whose bottom edge was pressed.
 * @returns the nearest open row at or above the pressed row; undefined when there is none.
 */
export function stackDragAnchor<T extends { readonly viewId: string; readonly folded: boolean }>(
  rows: readonly T[],
  viewId: string,
): T | undefined {
  const at = rows.findIndex((row) => row.viewId === viewId);
  if (at < 0) return undefined;
  for (let index = at; index >= 0; index -= 1) {
    if (rows[index]!.folded !== true) return rows[index];
  }
  return undefined;
}

export function stackEntries(node: LayoutNode): RegionNode[] {
  if (node.type !== "split" || node.dir !== "column") return [];
  const entries = node.children.filter(
    (child): child is RegionNode => child.type === "region" && child.entry === true,
  );
  return entries.length === node.children.length ? entries : [];
}

/**
 * Set a stack row's height — the leaf region's own `size`, which is what the layout draws.
 *
 * @param state - current state.
 * @param entryId - the entry region's id.
 * @param height - the height to hold.
 * @returns the new state, or the same one when nothing changes.
 */
export function setEntryHeight(state: LayoutState, entryId: string, height: number): LayoutState {
  const node = findRegion(state.tree, entryId);
  // A folded row is a header, not a height (J3); the fold toggle/expansion owns its `size`.
  if (node === null || node.collapsed === true) return state;
  const size = Math.max(
    MIN_ENTRY,
    Math.min(node.max ?? Number.POSITIVE_INFINITY, Math.round(height)),
  );
  if (node.size === size && node.flex !== true) return state;
  // A height a person dragged is a **fixed** height: a flexible row's element is `flex: 1 1 0` and
  // ignores `size`, so writing the number alone would leave the picture unchanged.
  const tree = updateRegion(state.tree, entryId, (entry) => ({ ...entry, size, flex: false }));
  return { ...state, tree };
}

/**
 * Fold or unfold a stack row, with the same two-field rule a folded row has in the design: the
 * height it remembers goes in `cachedSize`, and `size` stops being a height (E1/E2).
 *
 * @param state - current state.
 * @param entryId - the entry region's id.
 * @param collapsed - whether the row should be folded.
 * @param measuredHeight - the height it is drawn at right now, if the caller knows it.
 * @returns the new state, or the same one when nothing changes.
 */
export function setEntryFolded(
  state: LayoutState,
  entryId: string,
  collapsed: boolean,
  measuredHeight?: number,
): LayoutState {
  const node = findRegion(state.tree, entryId);
  if (node === null || (node.collapsed === true) === collapsed) return state;
  const before = node.size;
  const remembered = measuredHeight ?? node.size ?? node.cachedSize;
  const cachedSize = remembered === undefined ? undefined : Math.round(remembered);
  // A folded row has **no height**: its 22px header is drawing (`STACK_HEADER_HEIGHT` is applied by the
  // frame/allocation to `collapsed` rows), and the height it remembers lives in `cachedSize` (E1).
  const size = collapsed
    ? 0
    : node.cachedSize === undefined
      ? MIN_ENTRY
      : Math.max(
          MIN_ENTRY,
          Math.min(node.max ?? Number.POSITIVE_INFINITY, Math.round(node.cachedSize)),
        );

  // The row's own new height…
  let tree = updateRegion(state.tree, entryId, (entry) => ({
    ...entry,
    collapsed,
    size,
    // A folded row keeps the height it remembered; an open one mirrors `size`, the way `regionNode`
    // does. `cachedSize` is optional: omit it rather than write an undefined.
    ...(collapsed ? (cachedSize === undefined ? {} : { cachedSize }) : { cachedSize: size }),
  }));

  // …and where the difference goes (design C5/C6). A stack keeps its extent, so what a row gives up
  // goes to the rows **below it**, from the last one back, whole (no caps, not in proportion); what
  // it needs comes from the same rows, and none of them may be squeezed under the floor. When there
  // is nothing below, the room goes the same way **above** — the extent still has to be filled.
  // The folded row **occupies its header**, not its `size` (C4): the open rows only share out the
  // body the fold frees (or the body the unfold needs), not the 20px the header keeps.
  // An open flexible row's `size` is 0; its drawn height (the caller's measurement) is what it
  // actually gives up. A fixed row falls back to its own size when no measurement is available.
  const beforeOccupied = node.collapsed === true ? STACK_HEADER_HEIGHT : (measuredHeight ?? before);
  const afterOccupied = collapsed ? STACK_HEADER_HEIGHT : size;
  const delta = beforeOccupied - afterOccupied;
  if (delta !== 0) {
    const parent = findParentSplit(tree, entryId);
    const rows = parent === null ? [] : stackEntries(parent);
    const at = rows.findIndex((row) => row.id === entryId);
    const below = rows.slice(at + 1).reverse();
    const above = rows.slice(0, Math.max(0, at)).reverse();
    const take = (order: readonly RegionNode[], from: number): number => {
      for (const row of order) {
        if (from === 0) break;
        // B3: a folded row is a header — it neither gives nor takes.
        if (row.collapsed === true) continue;
        if (from > 0) {
          // C5/C6: fill the nearest capable row up to its own ceiling, then move on.
          const capacity = Math.max(0, (row.max ?? Number.POSITIVE_INFINITY) - row.size);
          const give = Math.min(capacity, from);
          if (give === 0) continue;
          tree = updateRegion(tree, row.id, (entry) => ({
            ...entry,
            size: entry.size + give,
            flex: false,
          }));
          from -= give;
        } else {
          const room = Math.max(0, row.size - MIN_ENTRY);
          const given = Math.min(room, -from);
          if (given === 0) continue;
          tree = updateRegion(tree, row.id, (entry) => ({
            ...entry,
            size: entry.size - given,
            flex: false,
          }));
          from += given;
        }
      }
      return from;
    };
    const left = take(below, delta);
    take(above, left);
  }
  return { ...state, tree };
}

/**
 * Move one stack row next to another — the same reference-and-direction move as `moveViewInRegion`,
 * but the order lives in the split's children now.
 *
 * @param state - current state.
 * @param entryId - the row being moved.
 * @param referenceId - the row it is dropped against.
 * @param direction - `"up"` lands it before the reference, `"down"` after it.
 * @returns the new state, or the same one when the move changes nothing.
 */
export function moveEntry(
  state: LayoutState,
  entryId: string,
  referenceId: string,
  direction: "up" | "down",
): LayoutState {
  if (entryId === referenceId) return state;
  // The rows may sit under a **region** (the container layer), so ask for the parent split rather
  // than walking only split children — that is the rule the note gives every id-based lookup.
  const parent = findParentSplit(state.tree, entryId);
  if (parent === null || findParentSplit(state.tree, referenceId)?.id !== parent.id) return state;
  const index = parent.children.findIndex((child) => child.id === entryId);
  if (index < 0 || !parent.children.some((child) => child.id === referenceId)) return state;
  const others = parent.children.filter((child) => child.id !== entryId);
  const at = others.findIndex((child) => child.id === referenceId);
  if (at < 0) return state;
  const target = direction === "up" ? at : at + 1;
  const moving = parent.children[index];
  if (moving === undefined) return state;
  const children = [...others.slice(0, target), moving, ...others.slice(target)];
  if (children.every((child, position) => child === parent.children[position])) return state;
  const tree = replaceNode(state.tree, parent.id, () => ({ ...parent, children }));
  // F7: the region has **one** order. A stack stores it in the split's children; the tab strip
  // stores it in `ViewRecord.order`. Renumber the rows' views so the two forms cannot drift when a
  // region changes mode.
  const views = { ...state.views };
  children.forEach((child, position) => {
    if (child.type !== "region" || child.entry !== true) return;
    const inRow = Object.entries(views)
      .filter(([, view]) => view.region === child.id)
      .sort((a, b) => a[1].order - b[1].order);
    inRow.forEach(([viewId], offset) => {
      const view = views[viewId];
      if (view !== undefined && view.order !== position + offset)
        views[viewId] = { ...view, order: position + offset };
    });
  });
  return { ...state, tree, views };
}

/**
 * Declare the height a view wants when it is a row of a stack.
 *
 * The declaration is the view's (or the app's on its behalf) — the layout only reads it, the same rule
 * `max` follows. A view that already has a row sizes **that row**; one that does not leaves the number
 * on its record, where shaping picks it up when the row appears.
 *
 * @param state - the layout state.
 * @param viewId - the view whose height is being declared.
 * @param size - the height in px.
 * @returns the state, or the same state when there is nothing to change.
 */
export function setViewSize(state: LayoutState, viewId: string, size: number): LayoutState {
  const view = state.views[viewId];
  if (view === undefined) return state;
  const rounded = Math.max(0, Math.round(size));
  // 0 is "no claim" (C1); any real height is a row's, so the floor and the view's own `max` apply
  // (C3/C6). This is a declaration: the layout only reads it.
  const wanted =
    rounded === 0
      ? 0
      : Math.max(MIN_ENTRY, Math.min(view.max ?? Number.POSITIVE_INFINITY, rounded));
  const home = view.region === undefined ? null : findRegion(state.tree, view.region);
  if (home?.entry === true) {
    const next =
      rounded === 0
        ? 0
        : Math.max(MIN_ENTRY, Math.min(home.max ?? Number.POSITIVE_INFINITY, rounded));
    // A folded row has no height to write (J3): the declaration updates the memory it will unfold
    // at, while `size` stays 0.
    if (home.collapsed === true) {
      if (home.cachedSize === next) return state;
      return {
        ...state,
        tree: updateRegion(state.tree, home.id, (row) => ({
          ...row,
          size: 0,
          flex: false,
          cachedSize: next,
        })),
      };
    }
    if (home.size === next && home.flex === (next === 0)) return state;
    return {
      ...state,
      tree: updateRegion(state.tree, home.id, (row) => ({ ...row, size: next, flex: next === 0 })),
    };
  }
  if (view.size === wanted) return state;
  return { ...state, views: { ...state.views, [viewId]: { ...view, size: wanted } } };
}

export function setViewCollapsed(
  state: LayoutState,
  viewId: string,
  collapsed: boolean,
  measuredHeight?: number,
): LayoutState {
  const view = state.views[viewId];
  if (view === undefined || view.collapsed === collapsed) return state;
  // A view that lives in a stack **row** folds through its region: that is where a row's height and
  // fold live, so writing the record flag would draw nothing.
  const home = view.region === undefined ? null : findRegion(state.tree, view.region);
  if (home?.entry === true) return setEntryFolded(state, home.id, collapsed, measuredHeight);
  if (collapsed) {
    // Folding writes the height into its **own** field; the entry's `size` stops being a height
    // (VS Code: `_cachedVisibleSize = size; size = 0`, `splitview.ts:237-238`). The frame's toggle
    // hands over the measured height; a drag hands over the size captured when the drag began.
    const remembered = measuredHeight ?? view.size ?? view.cachedSize;
    const cachedSize = remembered === undefined ? undefined : Math.round(remembered);
    return {
      ...state,
      views: { ...state.views, [viewId]: { ...view, collapsed, size: undefined, cachedSize } },
    };
  }
  // Unfolding goes back to the remembered height, **lifted to the floor** rather than dropped
  // (`clamp(cached, view.min, view.max)`, `splitview.ts:234`): a header-sized leftover would leave
  // the row stuck. Upstream reads **only** the memory here — the `size` argument of `setVisible` is
  // for the hide branch (`:237`), never for showing (`:234` reads `_cachedVisibleSize` alone). So a
  // row with no memory shares the height again instead of opening at whatever it currently measures,
  // which while folded is the header.
  const size =
    view.cachedSize === undefined
      ? undefined
      : Math.max(
          MIN_ENTRY,
          Math.min(view.max ?? Number.POSITIVE_INFINITY, Math.round(view.cachedSize)),
        );
  return {
    ...state,
    views: { ...state.views, [viewId]: { ...view, collapsed, size, cachedSize: undefined } },
  };
}
