/**
 * A layout root: one geometry tree plus its owner kind.
 *
 * The frame shell, a Space's stage and a board content use the same split / grid
 * / region primitives. The kinds name the owner, not a different algorithm:
 * `frame` is the shell, `space` is one virtual desktop of the stage, `board` is
 * a board window's content. A root is a boundary, not a second layout engine.
 *
 * @module prac-ui-kit-workbench/layoutRoot
 */
import type { LayoutNode } from "prac-ui-kit-layout";

/** The layout context a root belongs to. */
export type LayoutRootKind = "frame" | "space" | "board";

/** One layout tree, owned by the frame shell, a Space or a board window. */
export interface LayoutRoot {
  readonly id: string;
  readonly kind: LayoutRootKind;
  readonly tree: LayoutNode;
  readonly active?: string;
}
