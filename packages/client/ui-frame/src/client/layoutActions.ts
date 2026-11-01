/**
 * Generic per-item action slots.
 *
 * Window and widget actions live in separate slots; the legacy `prac.viewActions`
 * remains a fallback while views migrate. The component does not know the store:
 * it only asks the container's slot face to render the keys.
 *
 * @module prac-client-ui-frame/client/layoutActions
 */
import { createElement, Fragment } from "react";
import type { ReactNode } from "react";

/** Action slot keys for one item kind. */
export type ViewActionSlot = "prac.windowActions" | "prac.widgetActions" | "prac.viewActions";

/** Render one keyed action slot. */
export type RenderViewAction = (
  slot: ViewActionSlot,
  props: Record<string, never>,
  options: { readonly entryKey: string },
) => ReactNode;

/** Inputs for one item's action strip. */
export interface ViewActionsProps {
  readonly viewId: string;
  readonly kind: "window" | "widget";
  readonly renderSlot: RenderViewAction;
}

/** Render window/widget actions plus the legacy fallback. */
export function ViewActions({ viewId, kind, renderSlot }: ViewActionsProps): ReactNode {
  const slots: readonly ViewActionSlot[] =
    kind === "widget"
      ? ["prac.widgetActions", "prac.viewActions"]
      : ["prac.windowActions", "prac.viewActions"];
  return createElement(
    Fragment,
    null,
    slots.map((slot) =>
      createElement(Fragment, { key: slot }, renderSlot(slot, {}, { entryKey: viewId })),
    ),
  );
}
