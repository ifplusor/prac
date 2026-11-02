/**
 * Generic per-item action slots.
 *
 * Action slots are supplied by the caller. The component does not know the store:
 * it only asks the container's slot face to render the keys.
 *
 * @module prac-ui-kit-workbench/layoutActions
 */
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";

/** Render one keyed action slot. */
export type RenderItemAction = (
  slot: string,
  props: Record<string, unknown>,
  options?: Record<string, unknown>,
) => ReactNode;

/** Inputs for one item's action strip. */
export interface ItemActionsProps {
  readonly itemId: string;
  /** Action slots the caller owns, in render order. */
  readonly slots: readonly string[];
  readonly renderSlot: RenderItemAction;
}

/** Render one item's action slots. */
export function ItemActions({ itemId, slots, renderSlot }: ItemActionsProps): ReactNode {
  return createElement(
    Fragment,
    null,
    slots.map((slot) =>
      createElement(Fragment, { key: slot }, renderSlot(slot, {}, { entryKey: itemId })),
    ),
  );
}
