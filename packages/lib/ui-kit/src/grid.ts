/**
 * Pure grid geometry: placements, track weights, cell operations.
 *
 * @module prac-ui-kit/grid
 */

import type { Dir, GridNode, GridPlacement, LayoutNode, SplitNode } from "./geometry.js";
import { findNode, replaceNode } from "./tree.js";

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

