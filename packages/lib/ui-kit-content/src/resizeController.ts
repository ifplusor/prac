/**
 * Frame resize controllers: stack-row drag and split-boundary drag.
 *
 * These are top-level functions (not `PracFrame` closures) so the DOM sash and
 * row header can be shared; they only depend on the layout store and the rendered
 * boundary elements.
 *
 * @module prac-ui-kit-content/resizeController
 */
import type { PlacementRecord } from "./placement.js";
import type { LayoutStore } from "./store.js";
import type { Dir } from "prac-ui-kit-layout";
import {
  MIN_ENTRY,
  type SnapTarget,
  altDragTarget,
  findNode,
  redistributeOnDrag,
  resizeBoundary,
  resolveSizes,
  setCollapsed,
  setEntryHeight,
  snapTargets,
  stackDragAnchor,
} from "./model.js";
import { isPresent } from "./renderModel.js";

interface StackEntryNode {
  getBoundingClientRect(): { readonly bottom: number; readonly height: number };
  getAttribute(name: string): string | null;
}

/** What {@link readStackRows} needs of a container — a plain element qualifies structurally. */
export type StackContainer = Parameters<typeof readStackRows>[0];

export function readStackRows(
  container: { querySelectorAll(selectors: string): readonly StackEntryNode[] } | null,
): { itemId: string; height: number; folded: boolean }[] {
  return [...(container?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map((node) => ({
    itemId:
      node.getAttribute("data-prac-stack-row") ?? node.getAttribute("data-prac-stack-entry") ?? "",
    height: Math.round(node.getBoundingClientRect().height),
    folded: node.getAttribute("data-prac-stack-collapsed") === "true",
  }));
}

/**
 * One in-flight drag of a boundary between two **stack rows** (entry leaves).
 *
 * The rows come from the DOM (`readStackRows`), the arithmetic is `redistributeOnDrag`, and the
 * writes go into the tree — a row's height is its region's `size`, so the drawn height and the
 * stored height are one number. A stack row does **not** snap: dragging changes heights only; the
 * fold toggle is the one way a row folds (D3–D5).
 */
interface EntryDragState {
  pointerId: number;
  draggedId: string;
  container: StackContainer;
  rows: { itemId: string; height: number; folded: boolean }[];
  start: number;
  origin: number;
  limit: number;
}

let rowDrag: EntryDragState | null = null;

export function startEntryDrag<TRecord extends PlacementRecord>(
  store: LayoutStore<TRecord>,
  container: StackContainer,
  rowId: string,
  pointerId: number,
  origin: number,
  element: {
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
  } | null,
): void {
  const rows = readStackRows(container);
  // The boundary under a folded row still resizes the stack: the nearest **open** row above it is
  // the one that changes height, and the folded header moves with the boundary. Anchoring on the
  // folded row itself made every move a no-op (`stackDragAnchor`).
  const anchor = stackDragAnchor(rows, rowId);
  if (anchor === undefined) return;
  const index = rows.findIndex((row) => row.itemId === anchor.itemId);
  if (index < 0) return;
  const below = rows.slice(index + 1);
  // The drag is computed from the rows **as drawn**: seed every open row with that number before
  // the first move. Otherwise the untouched rows keep older claims, and `allocateStack`'s
  // proportional pass re-fits them on every pointermove — the elastic bounce reported during a drag
  // (only the rows the drag wrote matched what was on screen).
  store.update((state) => {
    let next = state;
    for (const row of rows) {
      if (!row.folded && row.height > 0) next = setEntryHeight(next, row.itemId, row.height);
    }
    return next;
  });
  const drag: EntryDragState = {
    pointerId,
    draggedId: anchor.itemId,
    container,
    rows,
    start: anchor.height,
    origin,
    limit:
      anchor.height + below.reduce((total, row) => total + Math.max(0, row.height - MIN_ENTRY), 0),
  };
  rowDrag = drag;
  const move = (moveEvent: PointerEvent): void => {
    if (rowDrag !== drag || moveEvent.pointerId !== drag.pointerId) return;
    moveEvent.preventDefault();
    const pointerDelta = moveEvent.clientY - drag.origin;
    // B6: Alt narrows the drag to the adjacent view's half (`SplitView.onSashStart`'s alt branch);
    // it changes heights only, never a fold.
    if (moveEvent.altKey === true) {
      const wanted = altDragTarget(drag.rows, drag.draggedId, drag.start + pointerDelta);
      const target = Math.max(MIN_ENTRY, Math.min(drag.limit, Math.round(wanted)));
      const sizes = redistributeOnDrag(drag.rows, drag.draggedId, target);
      store.update((state) => {
        let next = state;
        for (const [id, height] of sizes) next = setEntryHeight(next, id, height);
        return next;
      });
      return;
    }
    // D3–D5: a stack row does not snap — the drag changes heights only, and the fold toggle is the
    // one way a row folds.
    const wanted = Math.round(drag.start + pointerDelta);
    const target = Math.max(MIN_ENTRY, Math.min(drag.limit, wanted));
    const sizes = redistributeOnDrag(drag.rows, drag.draggedId, target);
    store.update((state) => {
      let next = state;
      for (const [id, height] of sizes) next = setEntryHeight(next, id, height);
      return next;
    });
  };
  /** End the drag from any source: pointerup, pointercancel, or the window losing focus. */
  const finish = (): void => {
    if (rowDrag !== drag) return;
    rowDrag = null;
    // "What is on screen is what the state says" (D2): the drag wrote the two rows it moved, and the
    // rows it did not touch may still claim a height the allocation has since re-fitted — write what
    // each of them is actually drawn at, so the claims and the screen agree again.
    const settled = readStackRows(drag.container);
    store.update((state) => {
      let next = state;
      for (const row of settled) {
        // A folded row is a header, not a height (J3): writing its 20px back would clamp it to the
        // floor and leave a misleading `size` behind.
        if (row.height > 0 && !row.folded) next = setEntryHeight(next, row.itemId, row.height);
      }
      return next;
    });
    element?.releasePointerCapture?.(pointerId);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", stop, true);
    document.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("blur", cancel);
  };
  const stop = (upEvent: PointerEvent): void => {
    if (rowDrag !== drag || upEvent.pointerId !== drag.pointerId) return;
    finish();
  };
  const cancel = (): void => {
    if (rowDrag !== drag) return;
    finish();
  };
  // Capture on the document, like the region boundary: a VS Code view host
  // inside the stack stops pointer events in its own subtree, and the row
  // boundary must keep following the pointer regardless.
  document.addEventListener("pointermove", move, { passive: false, capture: true });
  document.addEventListener("pointerup", stop, true);
  document.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  element?.setPointerCapture?.(pointerId);
}

/** One in-flight sash drag. */
interface DragState {
  pointerId: number;
  /** Pointer position along the split axis when the drag started. */
  origin: number;
  /** Which boundary of the split moved: the one after this child of its present children. */
  index: number;
  /** What the split's present children were drawn at when the drag started. */
  drawn: ReadonlyMap<string, number>;
  /** Set while the frame re-renders after a block went in or out, so the drag re-reads the pixels. */
  settling?: boolean;
  /** The blocks this drag may take away, and which side of their limits it is on. */
  snap: { before?: SnapTarget; after?: SnapTarget };
}

/** A generic (non-stack) split boundary drag: one at a time, driven from the window. */
interface SashDragState extends DragState {
  splitId: string;
  dir: Dir;
}

let sashDrag: SashDragState | null = null;
let sashCleanup: (() => void) | null = null;

/** What the split's present children are drawn at right now. */
export function readSplitDrawn<TRecord extends PlacementRecord>(
  store: LayoutStore<TRecord>,
  splitId: string,
  dir: Dir,
): Map<string, number> {
  const state = store.get();
  const node = findNode(state.tree, splitId);
  const drawn = new Map<string, number>();
  if (node === null || node.type !== "split") return drawn;
  // A grid can be `display: contents` (one cell), so it has no DOM box of its
  // own; fall back to the model's resolved box for that child.
  const resolved = resolveSizes(state, state.viewportWidth, state.viewportHeight);
  for (const child of node.children.filter((entry) => isPresent(state, entry))) {
    const element =
      document.querySelector(`[data-prac-region="${CSS.escape(child.id)}"]`) ??
      document.querySelector(`[data-prac-split="${CSS.escape(child.id)}"]`) ??
      document.querySelector(`[data-prac-grid="${CSS.escape(child.id)}"]`);
    const rect = element?.getBoundingClientRect();
    const measured = rect === undefined ? undefined : dir === "row" ? rect.width : rect.height;
    const fallback = resolved.get(child.id);
    const size =
      measured !== undefined && measured > 0
        ? measured
        : fallback?.[dir === "row" ? "width" : "height"];
    if (size !== undefined) drawn.set(child.id, size);
  }
  return drawn;
}

/**
 * Start a split-boundary drag.
 *
 * The move/up listeners live on the **window**, not on the sash element. A fast drag would otherwise
 * depend on the pointer staying over a four-pixel element (or on pointer capture surviving a
 * re-render that moves the sash under the pointer) — the reported "too fast and it stops" failure.
 * The element only supplies the starting pixels; the window keeps delivering events until pointerup,
 * pointercancel, or a window blur.
 */
export function startSashDrag<TRecord extends PlacementRecord>(
  store: LayoutStore<TRecord>,
  splitId: string,
  dir: Dir,
  index: number,
  pointerId: number,
  origin: number,
  element: {
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
  } | null,
): void {
  // A second pointerdown while a boundary drag is still live replaces it cleanly (no stale window
  // listeners left behind by the first).
  sashCleanup?.();
  const drawn = readSplitDrawn(store, splitId, dir);
  const drag: SashDragState = {
    pointerId,
    splitId,
    dir,
    index,
    origin,
    drawn,
    snap: snapTargets(store.get(), splitId, index, drawn),
  };
  sashDrag = drag;
  const move = (event: PointerEvent): void => {
    if (sashDrag !== drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (drag.settling === true) return;
    const point = dir === "row" ? event.clientX : event.clientY;
    const delta = point - drag.origin;
    // VS Code's sash snap, unless Alt is held (`splitview.ts:929`): past the limit the block goes
    // away with its size remembered, and back across the limit it returns.
    if (!event.altKey) {
      const before = drag.snap.before;
      const after = drag.snap.after;
      const wantedBeforeHidden = before !== undefined && before.size + delta < before.half;
      const wantedAfterHidden = after !== undefined && after.size - delta < after.half;
      const flipBefore = before !== undefined && before.hidden !== wantedBeforeHidden;
      const flipAfter = after !== undefined && after.hidden !== wantedAfterHidden;
      if (flipBefore || flipAfter) {
        store.update((state) => {
          let next = state;
          if (flipBefore && before !== undefined) {
            next = setCollapsed(next, before.id, wantedBeforeHidden, before.size);
          }
          if (flipAfter && after !== undefined) {
            next = setCollapsed(next, after.id, wantedAfterHidden, after.size);
          }
          return next;
        });
        drag.settling = true;
        const from = point;
        requestAnimationFrame(() => {
          if (sashDrag !== drag) return;
          drag.settling = false;
          drag.origin = from;
          drag.drawn = readSplitDrawn(store, splitId, dir);
          drag.snap = snapTargets(store.get(), splitId, drag.index, drag.drawn);
        });
        return;
      }
    }
    // The model moves the boundary: the drag is clamped to what the two sides can do (`min` / `max`)
    // and the space is handed out by `Sizing` — `distribute` spreads it over the whole side in
    // proportion (the default), `expand` pushes the neighbour only. `drawn` stays the base the drag
    // started from: `delta` is measured from the same pointer, so both have to be one coordinate.
    store.update((state) =>
      resizeBoundary(state, splitId, drag.index, delta, "distribute", drag.drawn),
    );
  };
  const cleanup = (): void => {
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", finish, true);
    document.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("blur", cancel);
    if (sashDrag === drag) sashDrag = null;
    if (sashCleanup === cleanup) sashCleanup = null;
    element?.releasePointerCapture?.(drag.pointerId);
  };
  const finish = (event?: PointerEvent): void => {
    if (sashDrag !== drag) return;
    if (event !== undefined && event.pointerId !== drag.pointerId) return;
    cleanup();
  };
  const cancel = (): void => finish();
  sashCleanup = cleanup;
  // Capture on the document: a view host may stop pointer events inside its
  // own subtree, and the boundary must keep following the pointer regardless.
  document.addEventListener("pointermove", move, { passive: false, capture: true });
  document.addEventListener("pointerup", finish, true);
  document.addEventListener("pointercancel", finish, true);
  window.addEventListener("blur", cancel);
  element?.setPointerCapture?.(pointerId);
}
