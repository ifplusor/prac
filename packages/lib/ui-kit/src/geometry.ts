/**
 * Geometry vocabulary shared by the layout solver and surface binding.
 *
 * The geometry tree is independent of the object graph. A node may be empty,
 * carry a surface, or be a pure split / grid / space container.
 *
 * @module prac-ui-kit/geometry
 */

/** Split direction. */
export type Axis = "row" | "column";

/** Leaf geometry node. */
export interface RegionNode {
  readonly kind: "region";
  readonly id: string;
  readonly collapsed?: boolean;
}

/** Linear split node. */
export interface SplitNode {
  readonly kind: "split";
  readonly id: string;
  readonly axis: Axis;
  readonly children: readonly GeometryNode[];
}

/** Grid node. */
export interface GridNode {
  readonly kind: "grid";
  readonly id: string;
  readonly children: readonly GeometryNode[];
}

/** Root space. */
export interface SpaceNode {
  readonly kind: "space";
  readonly id: string;
  readonly children: readonly GeometryNode[];
}

/** One node in the geometry tree. */
export type GeometryNode = SpaceNode | SplitNode | GridNode | RegionNode;

/** Resolved box, in CSS pixels or any caller-defined unit. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Minimum information a solver needs about one node's content. */
export interface NodeConstraints {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly flex?: boolean;
}
