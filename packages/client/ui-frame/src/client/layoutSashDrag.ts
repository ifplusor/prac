/**
 * A draggable boundary between two adjacent layout regions.
 *
 * The element is the generic {@link LayoutSash}; this module owns the container
 * side of it: the pointer-down dispatch (stack rows resize through the stack's
 * own controller, other boundaries through the split controller) and the
 * double-click reset. The frame and a board window both use it, so the drag
 * behaviour is one implementation with one store face.
 *
 * @module prac-client-ui-frame/client/layoutSashDrag
 */
import { createElement, useLayoutEffect, useRef } from "react";
import type { ReactElement } from "react";
import { findRegion, findSplit } from "prac-ui-kit";
import { SASH_SIZE, type Dir } from "./contract.js";
import { LayoutSash } from "./layoutSash.js";
import type { LayoutStore } from "./store.js";
import {
  entrySashState,
  distributeSplitEvenly,
  resetStackBoundary,
  setEntryHeight,
  snapTargets,
} from "./model.js";
import type { EntrySashState } from "./model.js";
import {
  readSplitDrawn,
  readStackRows,
  startEntryDrag,
  startSashDrag,
} from "./resizeController.js";
import type { StackContainer } from "./resizeController.js";

/** The pointer fields the sash reacts to (a DOM `PointerEvent` qualifies). */
export interface SashPointerEvent {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: {
    readonly parentElement: HTMLElement | null;
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
  };
  preventDefault(): void;
}

/** Props of one draggable boundary. */
export interface LayoutSashDragProps {
  readonly store: LayoutStore;
  readonly splitId: string;
  readonly dir: Dir;
  readonly index: number;
  readonly leftId: string;
  readonly rightId: string;
  /** A stack row boundary's `SashState`; the generic region boundaries leave it undefined. */
  readonly stackState?: EntrySashState;
  /** Where the boundary sits along the split's axis, in px (the preceding children's extent). */
  readonly offset: number;
}

/**
 * A draggable boundary between two adjacent regions.
 *
 * The sash is an **absolute overlay**: it takes no flex space, stays transparent until hovered or
 * dragged, and sits on the shared edge. Its drag is driven from the window (`startSashDrag`), so a
 * fast pointer cannot outrun a four-pixel element. The rule set is the one the spec fixes:
 * fixed|fixed grows one and shrinks the other; fixed|flex changes the fixed one; flex|flex does
 * nothing. The flex side keeps its own minimum, so a fixed neighbour can never squeeze it away.
 *
 * @param props - the boundary's identity and the two regions it separates.
 */
export function LayoutSashDrag({
  store,
  splitId,
  dir,
  index,
  leftId,
  rightId,
  stackState,
  offset,
}: LayoutSashDragProps): ReactElement {
  const sashRef = useRef<HTMLDivElement | null>(null);
  const half = SASH_SIZE / 2;
  // The model's offset is the initial guess; the DOM is the authority for the exact pixel. The
  // previous sibling is the region to the left/above the boundary (the sash is rendered after it).
  useLayoutEffect(() => {
    const element = sashRef.current;
    const previous = element?.previousElementSibling;
    const parent = element?.parentElement;
    if (!element || !previous || !parent) return;
    const parentBox = parent.getBoundingClientRect();
    const previousBox = previous.getBoundingClientRect();
    // A **grid wrapper with one cell** is `display: contents`, so its own rect is empty even though
    // its child is drawn; measuring it put the boundary at 0. Fall back to the allocation then.
    const drawn = dir === "row" ? previousBox.width > 0 : previousBox.height > 0;
    if (dir === "row") {
      element.style.left = drawn
        ? `${previousBox.right - parentBox.left - half}px`
        : `${offset - half}px`;
    } else {
      element.style.top = drawn
        ? `${previousBox.bottom - parentBox.top - half}px`
        : `${offset - half}px`;
    }
  });
  const onPointerDown = (event: SashPointerEvent): void => {
    if (event.button !== 0) return;
    const state = store.get();
    const split = findSplit(state.tree, splitId);
    const a = findRegion(state.tree, leftId);
    const b = findRegion(state.tree, rightId);
    // A collapsed block is deliberately draggable: that is how a drag brings it back (VS Code keeps
    // the sash usable for exactly this, `splitview.ts:1417-1420`).
    if (!split || !a || !b) return;
    const element = event.currentTarget;
    const container = element.parentElement;
    if (a.entry === true && b.entry === true && container !== null) {
      // Between two stack rows the boundary is the stack's own: floors and the four `SashState`
      // values are the stack's semantics (B/C/D), not the generic two-region resize.
      const rows = readStackRows(container as unknown as StackContainer);
      const at = rows.findIndex((row) => row.viewId === a.id);
      if (at < 0) return;
      const state = entrySashState(
        store.get(),
        a.id,
        new Map(rows.map((row) => [row.viewId, row.height])),
      );
      if (state === "disabled") return;
      startEntryDrag(
        store,
        container as unknown as StackContainer,
        a.id,
        event.pointerId,
        event.clientY,
        element,
      );
      event.preventDefault();
      return;
    }
    // The move/up listeners live on the window (`startSashDrag`): a fast drag cannot outrun a
    // four-pixel element or a re-render that moves it.
    startSashDrag(
      store,
      splitId,
      dir,
      index,
      event.pointerId,
      dir === "row" ? event.clientX : event.clientY,
      element,
    );
    event.preventDefault();
  };

  const onDoubleClick = (): void => {
    const state = store.get();
    const a = findRegion(state.tree, leftId);
    const b = findRegion(state.tree, rightId);
    if (a?.entry !== true || b?.entry !== true) {
      // A region boundary: a reset never lands on a **hidden** neighbour (VS Code returns early
      // there, `splitview.ts:1193-1199`); otherwise the split's blocks share what there is evenly.
      const drawn = readSplitDrawn(store, splitId, dir);
      const { before, after } = snapTargets(state, splitId, index, drawn);
      if (before?.hidden === true || after?.hidden === true) return;
      store.update((next) => distributeSplitEvenly(next, splitId, drawn));
      return;
    }
    // A row's parent element is the split's container, which is what `readStackRows` walks.
    const row = document.querySelector(`[data-prac-region="${CSS.escape(leftId)}"]`);
    const host = row?.parentElement;
    if (host === null || host === undefined) return;
    const reset = resetStackBoundary(readStackRows(host as unknown as StackContainer), leftId);
    store.update((next) => {
      let out = next;
      for (const { viewId, height } of reset) out = setEntryHeight(out, viewId, height);
      return out;
    });
  };

  return createElement(LayoutSash, {
    splitId,
    dir,
    index,
    leftId,
    rightId,
    offset,
    ...(stackState === undefined ? {} : { stackState }),
    onPointerDown: (event) => onPointerDown(event as unknown as SashPointerEvent),
    onDoubleClick: () => onDoubleClick(),
  });
}
