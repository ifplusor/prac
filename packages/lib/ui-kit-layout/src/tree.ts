/**
 * Pure tree navigation and rewriting over layout geometry.
 *
 * These helpers never touch view records or DOM: they answer "where is this
 * node", "replace that node", and "what is the smallest this subtree can be".
 *
 * @module prac-ui-kit-layout/tree
 */

import type { LayoutNode, RegionNode, SplitNode } from "./geometry.js";

/** Children of any node kind. */
function childNodes(node: LayoutNode): readonly LayoutNode[] {
  return node.type === "split" ? node.children : (node.children ?? []);
}

/** Depth-first region lookup. */
export function findRegion(node: LayoutNode, id: string): RegionNode | null {
  if (node.type === "region" && node.id === id) return node;
  for (const child of childNodes(node)) {
    const found = findRegion(child, id);
    if (found) return found;
  }
  return null;
}

/** Depth-first split lookup. */
export function findSplit(node: LayoutNode, id: string): SplitNode | null {
  if (node.type === "split" && node.id === id) return node;
  for (const child of childNodes(node)) {
    const found = findSplit(child, id);
    if (found) return found;
  }
  return null;
}

/** First region in tree order. */
export function firstRegionId(node: LayoutNode): string {
  const children = childNodes(node);
  if (node.type === "region" && children.length === 0) return node.id;
  return firstRegionId(children[0]!);
}

/** The node with this id, anywhere in the tree. */
export function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** Replace the node with this id, preserving object identity when nothing changed. */
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

/** Replace one region's record. */
export function updateRegion(
  tree: LayoutNode,
  id: string,
  updater: (node: RegionNode) => RegionNode,
): LayoutNode {
  return replaceNode(tree, id, (node) => (node.type === "region" ? updater(node) : node));
}

/** Generate an id no node in the tree carries. */
export function freshNodeId(tree: LayoutNode, kind: string, next: () => number): string {
  let id = `${kind}-${next()}`;
  while (findNode(tree, id) !== null) id = `${kind}-${next()}`;
  return id;
}

/** Smallest extent a subtree can occupy along its split axis. */
export function subtreeMin(node: LayoutNode): number {
  if (node.type === "grid") return Math.max(0, ...node.children.map(subtreeMin));
  if (node.type === "split")
    return node.children.reduce((total, child) => total + subtreeMin(child), 0);
  const children = node.children;
  if (children !== undefined && children.length > 0) {
    return Math.max(node.min, ...children.map((child) => subtreeMin(child)));
  }
  return node.min;
}
