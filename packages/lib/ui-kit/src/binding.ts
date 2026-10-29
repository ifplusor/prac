/**
 * Geometry-node → surface binding.
 *
 * Binding is deliberately separate from the geometry tree and from the object
 * graph: a node can be re-bound without rebuilding either side.
 *
 * @module prac-ui-kit/binding
 */

import type { GeometryNode } from "./geometry.js";
import type { Surface } from "./surface.js";

/** One node's current surface. */
export interface SurfaceBinding<TGroup = unknown> {
  readonly nodeId: string;
  readonly surface: Surface<TGroup>;
}

/** Read/write surface bindings for a geometry tree. */
export interface SurfaceBinder<TGroup = unknown> {
  bind(nodeId: string, surface: Surface<TGroup>): SurfaceBinding<TGroup>;
  unbind(nodeId: string): Surface<TGroup> | undefined;
  get(nodeId: string): SurfaceBinding<TGroup> | undefined;
}

/** Walk every node id in a geometry tree. */
export function geometryNodeIds(node: GeometryNode): readonly string[] {
  if (node.type === "region") return [node.id];
  return [node.id, ...(node.children ?? []).flatMap((child) => geometryNodeIds(child))];
}
