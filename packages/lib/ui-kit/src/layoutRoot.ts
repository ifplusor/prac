/**
 * A layout root: one geometry tree plus its item kind.
 *
 * The frame and a board content use the same split / grid / region primitives,
 * but their items differ: the frame root lays out windows, a board root lays out
 * widgets. A root is the boundary between those two item vocabularies; it does
 * not duplicate the layout algorithms.
 *
 * @module prac-ui-kit/layoutRoot
 */
import type { LayoutNode } from "./geometry.js";

/** The item vocabulary a root lays out. */
export type LayoutRootKind = "frame" | "board";

/** One layout tree, owned by a frame or a board window. */
export interface LayoutRoot {
  readonly id: string;
  readonly kind: LayoutRootKind;
  readonly tree: LayoutNode;
  readonly active?: string;
}
