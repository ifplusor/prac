/**
 * Pure split allocation.
 *
 * The solver takes claims and an extent; it does not know about DOM, React or
 * view records. A caller supplies the stack header height when rows are folded.
 *
 * @module prac-ui-kit-layout/allocation
 */

import type { LayoutNode, LayoutPriority, SplitNode } from "./geometry.js";

/**
 * The size a node contributes to its parent split along the split's axis.
 *
 * @param node - the child node.
 */
export function nodeBasis(node: LayoutNode): Basis {
  // A split without them shares the leftover, exactly as before they existed; a split standing in
  // for a fixed-size region carries that region's basis instead.
  if (node.type === "split") {
    return {
      flex: node.flex ?? true,
      size: node.size ?? 0,
      min: 0,
      max: node.max ?? Number.POSITIVE_INFINITY,
      priority: node.priority ?? "normal",
    };
  }
  if (node.collapsed)
    return { flex: false, size: 0, min: 0, max: 0, priority: node.priority ?? "normal" };
  return {
    flex: node.flex ?? false,
    size: node.size ?? 0,
    min: node.min ?? 0,
    max: node.max ?? Number.POSITIVE_INFINITY,
    priority: node.priority ?? "normal",
  };
}

/** What one child claims of its split's extent (VS Code: `size` / `minimumSize` / `maximumSize`). */
export interface Basis {
  readonly flex: boolean;
  readonly size: number;
  readonly min: number;
  readonly max: number;
  readonly priority: LayoutPriority;
}

/** VS Code's order: `high` is resized first, so it is the first to give way and the last to get room. */
const priorityRank = (priority: LayoutPriority | undefined): number =>
  priority === "high" ? 0 : priority === "low" ? 2 : 1;

/** A claim clamped into its own bounds. */
const clampClaim = (basis: Basis, size: number): number =>
  Math.min(basis.max, Math.max(basis.min, Math.round(size)));

/** Whether every child of this split is a stack row — i.e. the split **is** a stack. */
export function isStackSplit(node: SplitNode, children: readonly LayoutNode[]): boolean {
  return (
    children.length > 0 &&
    children.every((child) => child.type === "region" && child.entry === true)
  );
}

/**
 * Share a **stack's** extent out the way VS Code's `SplitView` does (design C6/C8).
 *
 * When every open row has a claim (a drag writes them all; a declared size counts too), the extent
 * is shared by those **proportions** first — `SplitView.layout`'s `proportionalLayout`, default true
 * (C8) — and each share is clamped to its bounds. The remainder then follows C6 below.
 *
 * A row that nobody has sized takes an even share to begin with; after that, room that appears goes
 * to **one** row — the first that can still grow, looking from the last one back — up to what it
 * declares, and room that is taken comes back the same way, never under a floor. A folded row (one
 * whose claim is pinned to its header) neither gives nor takes: it is skipped, and the search
 * continues past it (B3). When no row can move, the leftover simply stays unassigned, which is the
 * blank space the rules call for (H3).
 *
 * @param basis - one claim per row, in the split's order.
 * @param content - the extent to share out, sashes already taken off.
 * @param folded - which rows are folded (they hold a header and nothing else).
 * @returns one size per row.
 */
export function allocateStack(
  basis: readonly Basis[],
  content: number,
  folded: readonly boolean[] = [],
  headerHeight = 0,
): number[] {
  // A folded row holds its **header**, and that height is part of the stack's extent like any other
  // (its claim reads 0 because a folded row is drawn from its header, not from a `size` of its own).
  const sized = basis.map((entry, index) => (folded[index] === true ? headerHeight : entry.size));
  const open = basis.map((_, index) => index).filter((index) => folded[index] !== true);
  // C8: when every open row has a claim it has a **proportion** (after a drag, the drag writes every
  // open row; a view that declares a size is the same), so a region resize shares the extent by
  // those proportions — `SplitView.layout`'s `proportionalLayout` (default true). A stack whose open
  // rows include one nobody has sized has no complete set of proportions; it falls back to C1 (an
  // equal share for the unsized rows), which is the prac default for a fresh stack.
  const hasProportions = open.length > 0 && open.every((index) => basis[index]!.size > 0);
  if (hasProportions) {
    const total = open.reduce((sum, index) => sum + basis[index]!.size, 0);
    const contentForOpen = Math.max(0, content - (basis.length - open.length) * headerHeight);
    for (const index of open) {
      const entry = basis[index]!;
      sized[index] = Math.max(
        entry.min,
        Math.min(entry.max, (entry.size / total) * contentForOpen),
      );
    }
  } else {
    const settled = sized.reduce((total, size) => total + size, 0);
    // A row nobody has sized takes an equal share of what the sized ones leave (C1) — the fold's own
    // header is not part of what is shared out (C4).
    const unsized = basis
      .map((_, index) => index)
      .filter((index) => folded[index] !== true && basis[index]!.size === 0);
    if (unsized.length > 0) {
      const share = Math.max(0, content - settled) / unsized.length;
      for (const index of unsized) {
        const entry = basis[index]!;
        sized[index] = Math.max(entry.min, Math.min(entry.max, share));
      }
    }
  }
  const claimed = sized.reduce((total, size) => total + size, 0);
  let room = content - claimed;
  const order = basis.map((_, index) => index).reverse();
  const capable = (index: number, sign: 1 | -1): number => {
    if (folded[index] === true) return 0;
    const entry = basis[index]!;
    return sign > 0
      ? Math.max(0, entry.max - sized[index]!)
      : Math.max(0, sized[index]! - entry.min);
  };
  while (room > 0) {
    const next = order.find((index) => capable(index, 1) > 0);
    if (next === undefined) break;
    const take = Math.min(room, capable(next, 1));
    sized[next] = sized[next]! + take;
    room -= take;
  }
  while (room < 0) {
    const next = order.find((index) => capable(index, -1) > 0);
    if (next === undefined) break;
    const give = Math.min(-room, capable(next, -1));
    sized[next] = sized[next]! - give;
    room += give;
  }
  return sized;
}

/**
 * Give a split's extent to its children.
 *
 * Each child starts at its own claim, clamped; what is left over goes to the **flexible** ones, in
 * proportion to what they already claim (a child that claims nothing counts as one unit, which is how
 * a stack's untouched rows share equally). Too little room is taken back in priority order — `high`
 * first, `low` last, never under a `min` — so "who gives way" is a property of the tree, not an
 * accident of the arithmetic.
 *
 * @param basis - one claim per child, in the split's order.
 * @param content - the extent to share out, sashes already taken off.
 * @returns one size per child.
 */
export function allocateContent(basis: readonly Basis[], content: number): number[] {
  // A fixed child is honoured (clamped); a flexible one starts at what it claims — nothing, for a
  // sibling nobody has touched — so untouched siblings share **evenly**, and a dragged split (whose
  // children now claim their sizes) keeps its proportions when the frame changes.
  const sizes = basis.map((entry) =>
    entry.flex ? Math.min(entry.size, entry.max) : clampClaim(entry, entry.size),
  );
  const grow = (amount: number): void => {
    let room = amount;
    let open = basis.map((_, index) => index).filter((index) => basis[index]!.flex);
    while (room > 1e-6 && open.length > 0) {
      // In proportion to what each holds; siblings nobody has sized count as one unit each, which is
      // how a fresh split comes out even.
      const held = open.map((index) => sizes[index]!);
      const weights = held.some((size) => size > 0) ? held : open.map(() => 1);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let moved = 0;
      const next: number[] = [];
      open.forEach((index, position) => {
        const entry = basis[index]!;
        const share = (room * weights[position]!) / total;
        const take = Math.min(share, entry.max - sizes[index]!);
        sizes[index] = sizes[index]! + take;
        moved += take;
        if (sizes[index]! < entry.max) next.push(index);
      });
      room -= moved;
      open = next;
      if (moved <= 1e-6) break;
    }
  };

  const claimed = sizes.reduce((total, size) => total + size, 0);
  if (content - claimed > 0) {
    grow(content - claimed);
    // A floor is a promise, not a preference: whatever ended up under its `min` is raised, and the
    // room comes from the siblings with the most to spare.
    for (let round = 0; round < basis.length; round += 1) {
      const short = basis
        .map((_, index) => index)
        .filter((index) => basis[index]!.flex && sizes[index]! < basis[index]!.min);
      if (short.length === 0) break;
      let need = short.reduce((total, index) => total + (basis[index]!.min - sizes[index]!), 0);
      const donors = basis
        .map((_, index) => index)
        .filter((index) => sizes[index]! - basis[index]!.min > 0)
        .sort((a, b) => sizes[b]! - basis[b]!.min - (sizes[a]! - basis[a]!.min));
      for (const index of donors) {
        if (need <= 1e-6) break;
        const spare = sizes[index]! - basis[index]!.min;
        const give = Math.min(need, spare);
        sizes[index] = sizes[index]! - give;
        need -= give;
      }
      const total = short.reduce((sum, index) => sum + (basis[index]!.min - sizes[index]!), 0);
      if (total <= 1e-6) break;
      for (const index of short)
        sizes[index] = Math.min(basis[index]!.min, sizes[index]! + total / short.length);
    }
    return sizes;
  }

  let need = -(content - claimed);
  const order = basis
    .map((_, index) => index)
    .sort((a, b) => priorityRank(basis[a]!.priority) - priorityRank(basis[b]!.priority) || b - a);
  for (const index of order) {
    if (need <= 1e-6) break;
    const give = Math.min(need, sizes[index]! - basis[index]!.min);
    if (give <= 0) continue;
    sizes[index] = sizes[index]! - give;
    need -= give;
  }
  return sizes;
}
