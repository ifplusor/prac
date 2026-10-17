/**
 * The frame: the region tree rendered as DOM, plus the sashes between regions.
 *
 * It reads the store, renders one view per region through DSH's `renderSlot`
 * face, and dispatches child slots by *declaration* (registry membership — see
 * `catalogue`), never by the view id's name.
 *
 * Written with `createElement` rather than JSX: the client bundle is built by
 * the shared `packages/client/.../vite.config.ts` pack entry, which has no JSX
 * transform configured, and adding one is a build-config decision, not a frame
 * one.
 *
 * @module prac-client-ui-layout/client/frame
 */

import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { UsePanelInfo } from "@deepseek-ai/dsh-client-ui-layout/client";
import type { UseSessions } from "@deepseek-ai/dsh-client-ui-session/client";
import {
  DSH_MAIN_PREFIX,
  DSH_RIGHTBAR_VIEW,
  DSH_SIDEBAR_VIEW,
  DSH_VIEW_SOURCE,
  VIEW_SLOT,
  declaredViewIcon,
  declaredViewLabel,
  isDeclaredView,
  viewSource,
} from "./catalogue.js";
import {
  SASH_SIZE,
  type Box,
  type Dir,
  type LayoutNode,
  ZERO_BOX,
  type RegionNode,
  type SplitNode,
  type StyleObject,
} from "./contract.js";
import { mountIsolated, releaseIsolated } from "./isolation.js";
import {
  entrySashState,
  type EntrySashState,
  activeChild,
  chosenChild,
  edgeRegion,
  findRegion,
  findSplit,
  isPresent,
  frontView,
  resizeBoundary,
  resolveSizes,
  setFront,
  selectChild,
  showsTabStrip,
  visibleViews,
  MIN_ENTRY,
  HEADER_HEIGHT,
  STACK_HEADER_HEIGHT,
  altDragTarget,
  redistributeOnDrag,
  stackDragAnchor,
  setViewCollapsed,
  moveViewInRegion,
  resetStackBoundary,
  setEntryFolded,
  moveEntry,
  setEntryHeight,
  setCollapsed,
  findNode,
  distributeSplitEvenly,
  type SnapTarget,
  snapTargets,
} from "./model.js";
import { type LayoutStore, useLayout } from "./store.js";
import type { LayoutState } from "./contract.js";

/** A minimal pointer event, as the sash drag machine reads it. */
interface PointerDragEvent {
  readonly pointerId: number;
  readonly button: number;
  /** Alt turns the sash snap off, the way VS Code does (`splitview.ts:929`). */
  readonly altKey?: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: {
    readonly parentElement: {
      readonly clientWidth: number;
      readonly clientHeight: number;
      /** The entries of the stack this element belongs to (see `stackEntry`). */
      querySelectorAll(selectors: string): readonly {
        getBoundingClientRect(): { readonly bottom: number; readonly height: number };
        getAttribute(name: string): string | null;
      }[];
    } | null;
    getBoundingClientRect(): { readonly bottom: number; readonly height: number };
    getAttribute(name: string): string | null;
    setPointerCapture(pointerId: number): void;
    hasPointerCapture?(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
  };
  preventDefault(): void;
}

/**
 * The `renderSlot` face the frame dispatches child slots through.
 *
 * Derived from the real one (`PropsRenderSlots`) over this frame's declared child
 * keys, so a dispatch to a key the frame did not declare is a type error.
 */
type RenderSlot = import("@deepseek-ai/dsh-client-ui-slots").PropsRenderSlots<
  "sidebar" | "main" | "rightbar" | "shell.overlay" | "prac.view"
>["renderSlot"];

// ── the frame ─────────────────────────────────────────────────────────

/** Props of one placed view. */
interface ViewProps {
  viewId: string;
  renderSlot: RenderSlot;
  /** The box of the region currently rendering this view. */
  box: Box;
  viewportWidth: number;
}

/**
 * Render one of DSH's own slots as a view: the keyed `main` slot per key, the
 * `sidebar` and `rightbar` single slots with the owner props their occupants
 * read.
 *
 * @param viewId - a `dsh:` view id.
 * @param renderSlot - DSH's slot dispatch face.
 * @param box - the box of the region rendering the view.
 * @param viewportWidth - the measured frame width.
 * @returns the rendered slot, or null for an unknown `dsh:` id.
 */
function renderDshView(
  viewId: string,
  renderSlot: RenderSlot,
  box: Box,
  viewportWidth: number,
): ReactNode {
  if (viewId.startsWith(DSH_MAIN_PREFIX)) {
    return renderSlot("main", {}, { entryKey: viewId.slice(DSH_MAIN_PREFIX.length) });
  }
  if (viewId === DSH_SIDEBAR_VIEW) {
    return renderSlot("sidebar", { collapsed: box.width === 0, width: box.width });
  }
  if (viewId === DSH_RIGHTBAR_VIEW) {
    return renderSlot("rightbar", {
      width: box.width,
      viewportWidth,
      canShow: box.width > 0,
    });
  }
  return null;
}

/**
 * One placed view, rendered in its own component so each instance keeps its
 * own hooks: `renderSlot` is called once per view per render.
 *
 * The **declaration** decides the dispatch, never the position and never the id's
 * name: DSH's own slots render through DSH's slot face, and a view the
 * `prac.view` slot declares renders that declaration (membership is read from the
 * registry — see {@link isDeclaredView}). Anything else renders nothing.
 *
 * @param props - the placed view's identity, slot face and region box.
 */
function View({ viewId, renderSlot, box, viewportWidth }: ViewProps): ReactNode {
  const source = viewSource(viewId);
  if (source === DSH_VIEW_SOURCE) return renderDshView(viewId, renderSlot, box, viewportWidth);
  if (isDeclaredView(viewId)) return renderSlot(VIEW_SLOT, {}, { only: viewId });
  return null;
}

/**
 * A view inside its own isolation boundary.
 *
 * The frame owns the boundary (a view does not choose whether it is isolated),
 * so this is the only place a root is created: one host element for the view's
 * box, one shadow root, and the view's tree rendered into it through a portal.
 * `isolation.ts` keeps the root supplied with the frame's own styles and the
 * document's attributes.
 *
 * @param props - the view's rendered tree.
 */
function IsolatedView({
  children,
  clickThrough = false,
  chrome,
}: {
  children?: ReactNode;
  /** The box itself lets events pass; its entries opt back in (the float layer). */
  clickThrough?: boolean;
  /** When the frame owns the row title, hide the view's own duplicate collapse affordance. */
  chrome?: "frame";
}): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    setContent(mountIsolated(element));
    return () => {
      releaseIsolated(element);
      setContent(null);
    };
  }, []);
  return createElement(
    "div",
    {
      ref: host,
      "data-prac-view-host": "",
      ...(chrome === "frame" ? { "data-prac-view-chrome": "frame" } : {}),
      style: {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        ...(clickThrough ? { pointerEvents: "none" as const } : {}),
      },
    },
    content ? createPortal(children, content) : null,
  );
}

/** A view's display label: its declared title, else the tail of its id. */
function viewLabel(viewId: string): string {
  return declaredViewLabel(viewId) ?? (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");
}

/** The icon a stacked view declared, as an opaque class (the adapter owns its meaning). */
const viewIcon = (viewId: string): string | undefined => declaredViewIcon(viewId);

/** The icon element, or null when the view declared none. */
const viewIconNode = (viewId: string): ReactElement | null => {
  const icon = viewIcon(viewId);
  return icon === undefined
    ? null
    : createElement("span", {
        "aria-hidden": "true",
        className: icon,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
          width: "16px",
          height: "100%",
          fontSize: "14px",
        },
      });
};

/** The header a stacked view carries: its label plus a fold toggle. */

const STACK_HEADER_STYLE: StyleObject = {
  display: "block",
  height: STACK_HEADER_HEIGHT,
  boxSizing: "border-box",
  width: "100%",
  textAlign: "left",
  padding: "2px 6px",
  font: "inherit",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  border: "none",
  borderTop: "1px solid rgba(128, 128, 128, 0.25)",
  background: "transparent",
  color: "inherit",
  opacity: 0.8,
};

/** The tab strip: one row above the active view's body (an editor group's chrome). */
const TAB_STRIP_STYLE: StyleObject = {
  display: "flex",
  alignItems: "stretch",
  height: HEADER_HEIGHT,
  boxSizing: "border-box",
  flex: "0 0 auto",
  overflow: "hidden",
  background: "rgba(127,127,127,0.10)",
};

/** One tab. */
const TAB_STYLE: StyleObject = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  height: HEADER_HEIGHT,
  boxSizing: "border-box",
  padding: "4px 10px",
  border: "none",
  borderRight: "1px solid rgba(127,127,127,0.22)",
  background: "transparent",
  color: "inherit",
  opacity: 0.7,
  cursor: "pointer",
  whiteSpace: "nowrap",
  maxWidth: "220px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: "0 0 auto",
};

/** The unsaved marker inside a tab. */
/** The close affordance on a tab whose declarer allows closing. */
const TAB_CLOSE_STYLE: StyleObject = {
  fontSize: "11px",
  lineHeight: "1",
  marginLeft: "6px",
  padding: "0 2px",
  borderRadius: "3px",
  opacity: 0.75,
  cursor: "pointer",
};

const TAB_DIRTY_STYLE: StyleObject = {
  fontSize: "9px",
  marginRight: "5px",
  verticalAlign: "middle",
  opacity: 0.9,
};

/**
 * Move one view's tab to another tab's place in the same region.
 *
 * Orders are only compared **within** a region (`visibleViews` sorts by them), so the
 * region's visible list is renumbered after the move — and the drag is a reorder, not a
 * placement: nothing else about the view changes.
 *
 * @param state - the current layout state.
 * @param regionId - the region whose tabs were dragged in.
 * @param dragged - the view that was dragged.
 * @param target - the view it was dropped on.
 * @returns the next state, or the same one when nothing moves.
 */
function reorderTab(
  state: LayoutState,
  regionId: string,
  dragged: string,
  target: string,
): LayoutState {
  if (dragged === target) return state;
  const list = visibleViews(state, regionId);
  const from = list.indexOf(dragged);
  const to = list.indexOf(target);
  if (from === -1 || to === -1) return state;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, dragged);
  const views = { ...state.views };
  next.forEach((id, index) => {
    const record = views[id];
    if (record !== undefined) views[id] = { ...record, order: index };
  });
  return { ...state, views };
}

/** The active tab, which is the view the region renders. */
const TAB_ACTIVE_STYLE: StyleObject = {
  opacity: 1,
  background: "rgba(127,127,127,0.22)",
  boxShadow: "inset 0 -1px 0 rgba(127,127,127,0.9)",
};

/**
 * The one stack-entry drag in flight, if any.
 *
 * Module state on purpose: the frame is a singleton per page, an entry is rendered by a plain
 * function (so a hook inside it would break the hook order), and only one drag can be in flight.
 */
/** One in-flight drag of an entry by its title: reordering, not resizing. */
/**
 * How far a press may drift before it counts as a drag instead of a click.
 *
 * A title bar answers to both: a click folds the entry (`setViewCollapsed`), a drag reorders it
 * (`moveViewInRegion`). This slop is what drag-and-drop layers use to tell the two apart.
 */
const REORDER_SLOP = 4;

let reorderDrag: {
  viewId: string;
  pointerId: number;
  container: HTMLElement;
  line: HTMLElement;
  origin: { x: number; y: number };
  moved: boolean;
  target: { reference: string; direction: "up" | "down" } | null;
} | null = null;

/** What a stack entry looks like through the little of the DOM this file touches. */
interface StackEntryNode {
  getBoundingClientRect(): { readonly bottom: number; readonly height: number };
  getAttribute(name: string): string | null;
}

/** Read a stack's entries, top-down, as they stand on screen. */
/** What {@link readStackRows} needs of a container — a plain element qualifies structurally. */
type StackContainer = Parameters<typeof readStackRows>[0];

function readStackRows(
  container: { querySelectorAll(selectors: string): readonly StackEntryNode[] } | null,
): { viewId: string; height: number; folded: boolean }[] {
  return [...(container?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map((node) => ({
    viewId:
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
  rows: { viewId: string; height: number; folded: boolean }[];
  start: number;
  origin: number;
  limit: number;
}

let rowDrag: EntryDragState | null = null;

function startEntryDrag(
  store: LayoutStore,
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
  const index = rows.findIndex((row) => row.viewId === anchor.viewId);
  if (index < 0) return;
  const below = rows.slice(index + 1);
  // The drag is computed from the rows **as drawn**: seed every open row with that number before
  // the first move. Otherwise the untouched rows keep older claims, and `allocateStack`'s
  // proportional pass re-fits them on every pointermove — the elastic bounce reported during a drag
  // (only the rows the drag wrote matched what was on screen).
  store.update((state) => {
    let next = state;
    for (const row of rows) {
      if (!row.folded && row.height > 0) next = setEntryHeight(next, row.viewId, row.height);
    }
    return next;
  });
  const drag: EntryDragState = {
    pointerId,
    draggedId: anchor.viewId,
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
        if (row.height > 0 && !row.folded) next = setEntryHeight(next, row.viewId, row.height);
      }
      return next;
    });
    element?.releasePointerCapture?.(pointerId);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", cancel);
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
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", cancel);
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
function readSplitDrawn(store: LayoutStore, splitId: string, dir: Dir): Map<string, number> {
  const state = store.get();
  const node = findNode(state.tree, splitId);
  const drawn = new Map<string, number>();
  if (node === null || node.type !== "split") return drawn;
  for (const child of node.children.filter((entry) => isPresent(state, entry))) {
    const element =
      document.querySelector(`[data-prac-region="${CSS.escape(child.id)}"]`) ??
      document.querySelector(`[data-prac-split="${CSS.escape(child.id)}"]`);
    const rect = element?.getBoundingClientRect();
    if (rect !== undefined) drawn.set(child.id, dir === "row" ? rect.width : rect.height);
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
function startSashDrag(
  store: LayoutStore,
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
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
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
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("blur", cancel);
  element?.setPointerCapture?.(pointerId);
}

/** Props of one draggable boundary. */
interface SashProps {
  store: LayoutStore;
  splitId: string;
  dir: Dir;
  index: number;
  leftId: string;
  rightId: string;
  /** A stack row boundary's `SashState`; the generic region boundaries leave it undefined. */
  stackState?: EntrySashState;
  /** Where the boundary sits along the split's axis, in px (the preceding children's extent). */
  offset: number;
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
function Sash({
  store,
  splitId,
  dir,
  index,
  leftId,
  rightId,
  stackState,
  offset,
}: SashProps): ReactElement {
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
    if (dir === "row") element.style.left = `${previousBox.right - parentBox.left - half}px`;
    else element.style.top = `${previousBox.bottom - parentBox.top - half}px`;
  });
  const onPointerDown = (event: PointerDragEvent): void => {
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
    const container = document.querySelector(
      `[data-prac-region="${CSS.escape(leftId)}"]`,
    )?.parentElement;
    if (container === null || container === undefined) return;
    const reset = resetStackBoundary(readStackRows(container as unknown as StackContainer), leftId);
    store.update((next) => {
      let out = next;
      for (const { viewId, height } of reset) out = setEntryHeight(out, viewId, height);
      return out;
    });
  };

  // The sash **overlays** the boundary instead of being a flex child: the regions fill the split,
  // and the four-pixel strip is centered on the shared edge. It is transparent until hovered (or
  // dragged), like VS Code's `monaco-sash`.
  const style: StyleObject =
    dir === "row"
      ? { left: offset - half, top: 0, bottom: 0, width: SASH_SIZE }
      : { top: offset - half, left: 0, right: 0, height: SASH_SIZE };
  return createElement("div", {
    "data-prac-sash": `${splitId}:${index}`,
    ref: sashRef,
    onDoubleClick,
    "data-prac-sash-dir": dir,
    "data-prac-sash-left": leftId,
    "data-prac-sash-right": rightId,
    ...(stackState === undefined ? {} : { "data-prac-stack-sash-state": stackState }),
    "aria-hidden": "true",
    style,
    onPointerDown,
  });
}

/** Frame-wide rules that cannot be expressed as inline styles on rendered entries. */
const FRAME_STYLES = `
[data-prac-overlay-layer] { display: flex; flex-direction: column; }
[data-prac-overlay-layer] > * { pointer-events: auto; }
[data-prac-region] { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
[data-prac-region] > * { flex: 1 1 auto; min-height: 0; }
[data-prac-sash] { position: absolute; z-index: 5; touch-action: none; user-select: none; background: transparent; }
[data-prac-sash][data-prac-sash-dir="row"] { cursor: col-resize; }
[data-prac-sash][data-prac-sash-dir="column"] { cursor: row-resize; }
[data-prac-sash][data-prac-stack-sash-state="at-minimum"] { cursor: s-resize; }
[data-prac-sash][data-prac-stack-sash-state="at-maximum"] { cursor: n-resize; }
[data-prac-sash][data-prac-stack-sash-state="disabled"] { cursor: default; pointer-events: none; }
[data-prac-sash]:hover, [data-prac-sash]:active { background: rgba(127, 127, 127, 0.35); }
:host([data-prac-view-chrome="frame"]) .pane-header .twisty-container,
:host([data-prac-view-chrome="frame"]) .pane-header .icon,
:host([data-prac-view-chrome="frame"]) .pane-header .title { display: none; }
:host([data-prac-view-chrome="frame"]) .pane-header { pointer-events: none; }
/* The action slot is the row's own, not a hover affordance: keep the view's action
   icons visible exactly as the view would show them on a focused pane. */
:host([data-prac-view-chrome="frame"]) .pane-header .actions {
  display: flex !important;
  opacity: 1 !important;
  visibility: visible !important;
  align-items: center;
  height: 100%;
}
:host([data-prac-view-chrome="frame"]) .pane-header .actions .action-label {
  opacity: 1 !important;
  visibility: visible !important;
}
:host([data-prac-view-chrome="frame"]) .pane-header .actions,
:host([data-prac-view-chrome="frame"]) .pane-header .actions * { pointer-events: auto; }
`;

/** Inject the frame's stylesheet once. */
export function ensureStyles(): void {
  if (document.getElementById("prac-client-ui-layout-styles")) return;
  const style = document.createElement("style");
  style.id = "prac-client-ui-layout-styles";
  style.textContent = FRAME_STYLES;
  document.head.append(style);
}

/**
 * A region's flex sizing: flexible, fixed at `size`, or collapsed to nothing.
 *
 * @param node - the region to style.
 * @param dir - the parent split's axis (the axis the minimum belongs on).
 */
function regionStyle(node: RegionNode, dir: Dir, fill = false, allocated?: number): StyleObject {
  if (node.collapsed) {
    // A folded stack row is **only its header** — a row that vanished entirely would lose the fold
    // switch that opens it again (design B4/D1).
    if (node.entry === true)
      return {
        flex: `0 0 ${STACK_HEADER_HEIGHT}px`,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      };
    return { flex: "0 0 0px", minWidth: 0, minHeight: 0, overflow: "hidden" };
  }
  // The minimum is expressed on the split's own axis: a flex region with
  // `min-width: 0` can be squeezed to nothing by its siblings.
  const minimum = {
    minWidth: dir === "row" ? node.min : 0,
    minHeight: dir === "column" ? node.min : 0,
  };
  const stack: StyleObject =
    node.stack === true || (node.children?.length ?? 0) > 0
      ? { display: "flex", flexDirection: "column" }
      : {};
  // A selector's child is not sized by a split — the selector hands it the whole
  // box — so it always fills, whatever basis it carries.
  if (fill) return { flex: "1 1 0", ...minimum, overflow: "hidden", ...stack };
  // A stack row is **drawn** at what the allocation gave it. The tree's `size` is only that row's
  // claim: the room a region gains has to end up in exactly one row (C6/C8), and which row that is
  // was decided by `allocateStack`, so the style has to follow the allocation rather than the claim.
  if (allocated !== undefined) {
    return {
      flex: `0 0 ${Math.round(allocated)}px`,
      ...minimum,
      overflow: "hidden",
      ...stack,
    };
  }
  if (node.flex) return { flex: "1 1 0", ...minimum, overflow: "hidden", ...stack };
  return { flex: `0 0 ${node.size}px`, ...minimum, overflow: "hidden", ...stack };
}

/**
 * A split's flex container: one axis, with children sized by their own basis.
 *
 * @param node - the split to style.
 */
function splitStyle(node: SplitNode): StyleObject {
  // The basis is the region's, the way `regionStyle` computes it: a split that took a **fixed**
  // region's place (a stack standing where the track was) has to keep that size, not take a share.
  // A size of 0 means "no opinion" — the container layer builds its children that way — while a
  // positive size with `flex: false` is a fixed extent the region carried over (the track a stack
  // now stands in). Either way the split must not shrink a sized neighbour.
  const basis =
    node.flex === false && (node.size ?? 0) > 0 ? `0 0 ${node.size}px` : ("1 1 0" as const);
  return {
    display: "flex",
    flexDirection: node.dir === "row" ? "row" : "column",
    flex: basis,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  };
}

/**
 * The session currently on screen, as DSH publishes it.
 *
 * It used to be a member of the session **list** state (`list.current`); in the shell this
 * repository runs, navigation moved out of the controller ("navigation belongs to view
 * owners") and the current binding is published as its own source
 * (`ctx.uiSession.adapter.current`). Structural here on purpose: the frame needs
 * `getSnapshot`/`subscribe`, nothing about sessions.
 */
export interface CurrentSessionSource {
  getSnapshot(): { readonly key?: string };
  subscribe(listener: () => void): () => void;
}

/** Props DSH hands the root slot component. */
interface FrameProps {
  renderSlot: RenderSlot;
  useSessions: UseSessions;
  usePanelInfo: UsePanelInfo;
}

/**
 * The frame: the region tree, plus the frame-wide overlay layer.
 *
 * `shell.overlay` stays a layer rather than a region — it is the additive slot
 * for surfaces that float above every region.
 *
 * @param store - the layout store this frame renders.
 */
export function createFrame(
  store: LayoutStore,
  sources: { readonly currentSession: CurrentSessionSource },
): (props: FrameProps) => ReactElement {
  return function PracFrame({ renderSlot, useSessions, usePanelInfo }: FrameProps): ReactElement {
    const state = useLayout(store);
    const frameRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
      const element = frameRef.current;
      if (!element) return undefined;
      let raf: number | null = null;
      const measure = (): void => {
        const box = element.getBoundingClientRect();
        if (box.width <= 0) return;
        store.update((current) =>
          current.viewportWidth === box.width && current.viewportHeight === box.height
            ? current
            : { ...current, viewportWidth: box.width, viewportHeight: box.height },
        );
      };
      measure();
      const observer = new ResizeObserver(() => {
        raf ??= requestAnimationFrame(() => {
          raf = null;
          measure();
        });
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        if (raf !== null) cancelAnimationFrame(raf);
      };
    }, []);

    const sizes = resolveSizes(state, state.viewportWidth, state.viewportHeight);
    // The `SashState` tests are about what the rows are **drawn** at: a flexible row claims 0 in the
    // tree, so the claim alone cannot answer B2. `sizes` is this render's allocation.
    const rowHeights = new Map<string, number>([...sizes].map(([id, box]) => [id, box.height]));

    /**
     * A region renders the front-most visible view from the views table.
     *
     * @param node - the region to render.
     * @param dir - the parent split's axis.
     */
    /**
     * One entry of a stack: a header (label + fold toggle) and, unless folded,
     * the view's body.
     *
     * @param viewId - the view this entry shows.
     * @param box - the box of the region holding the stack.
     */
    /**
     * Start a reorder: the pointer went down on an entry's **title** (not its bottom `SASH_SIZE`
     * px, which is the resizing sash, and not the fold switch). Upstream states a move as reference
     * + direction (`Grid.moveView`, `grid.ts:480-495`), so the drop target is "the row under the
     * pointer, above or below its midline"; a pointer that leaves the rows drops nothing and the
     * entry stays where it was. The dragged entry keeps its height and fold state — only `order`
     * changes — and this path never folds anything (`setViewCollapsed` is not involved).
     */
    const beginReorder = (
      down: PointerDragEvent,
      viewId: string,
      containerIn?: HTMLElement | null,
    ): void => {
      const container = containerIn ?? (down.currentTarget as HTMLElement).parentElement;
      if (container === null || container === undefined) return;
      const line = document.createElement("div");
      line.setAttribute("data-prac-stack-drop", viewId);
      Object.assign(line.style, {
        position: "absolute",
        left: "0",
        right: "0",
        height: "2px",
        background: "var(--vscode-focusBorder, #007fd4)",
        pointerEvents: "none",
        zIndex: "6",
      });
      const drag = {
        viewId,
        pointerId: down.pointerId,
        container,
        line,
        origin: { x: down.clientX, y: down.clientY },
        moved: false,
        target: null as { reference: string; direction: "up" | "down" } | null,
      };
      reorderDrag = drag;
      const rows = (): { id: string; element: HTMLElement; top: number; bottom: number }[] =>
        [...container.querySelectorAll<HTMLElement>("[data-prac-stack-entry]")].map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id:
              element.getAttribute("data-prac-stack-row") ??
              element.getAttribute("data-prac-stack-entry") ??
              "",
            element,
            top: rect.top,
            bottom: rect.bottom,
          };
        });
      const stop = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", drop);
        drag.line.remove();
        if (reorderDrag === drag) reorderDrag = null;
      };
      const drop = (): void => {
        if (reorderDrag !== drag) return;
        stop();
      };
      const move = (moveEvent: PointerEvent): void => {
        if (reorderDrag !== drag || moveEvent.pointerId !== drag.pointerId) return;
        // A press that stays put is a **click** (fold/unfold); only real movement reorders.
        if (
          Math.abs(moveEvent.clientX - drag.origin.x) > REORDER_SLOP ||
          Math.abs(moveEvent.clientY - drag.origin.y) > REORDER_SLOP
        ) {
          drag.moved = true;
        }
        if (!drag.moved) return;
        const hit = rows().find(
          (row) => moveEvent.clientY >= row.top && moveEvent.clientY < row.bottom,
        );
        if (hit === undefined || hit.id === "") {
          // Off the rows: nothing will be dropped, so show nothing.
          drag.target = null;
          drag.line.remove();
          return;
        }
        const direction = moveEvent.clientY < hit.top + (hit.bottom - hit.top) / 2 ? "up" : "down";
        drag.target = { reference: hit.id, direction };
        hit.element.appendChild(drag.line);
        drag.line.style.top = direction === "up" ? "0" : "";
        drag.line.style.bottom = direction === "down" ? "0" : "";
      };
      const finish = (upEvent: PointerEvent): void => {
        if (reorderDrag !== drag || upEvent.pointerId !== drag.pointerId) return;
        const target = drag.target;
        const moved = drag.moved;
        stop();
        if (!moved) {
          // They clicked the title rather than dragging it: that is the fold switch.
          const height = readStackRows(container as unknown as StackContainer).find(
            (row) => row.viewId === viewId,
          )?.height;
          store.update((state) =>
            findRegion(state.tree, viewId)?.entry === true
              ? setEntryFolded(
                  state,
                  viewId,
                  findRegion(state.tree, viewId)?.collapsed !== true,
                  height,
                )
              : setViewCollapsed(state, viewId, state.views[viewId]?.collapsed !== true, height),
          );
          return;
        }
        if (target === null || target.reference === viewId) return;
        store.update((state) =>
          findRegion(state.tree, viewId)?.entry === true
            ? moveEntry(state, viewId, target.reference, target.direction)
            : moveViewInRegion(state, viewId, target.reference, target.direction),
        );
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", drop);
      down.preventDefault();
    };

    /**
     * One region's tab strip: the visible views in order, the front one active.
     *
     * Borrowed from VS Code's editor group, including its `showTabs` default:
     * with `"multiple"` the strip is there for a single view too. Clicking a tab
     * brings that view to the front — the same ordering a `place` writes — so the
     * strip is a view of the region's order, not a second source of truth.
     *
     * @param views - the region's visible views, in order.
     */
    const tabStrip = (views: readonly string[], regionId: string): ReactElement => {
      const active = frontView(state, regionId) ?? views[0];
      return createElement(
        "div",
        {
          key: "tabs",
          "data-prac-tab-strip": "",
          style: TAB_STRIP_STYLE,
        },
        views.map((viewId) =>
          createElement(
            "button",
            {
              key: viewId,
              type: "button",
              "data-prac-tab": viewId,
              "data-prac-tab-active": viewId === active ? "true" : "false",
              // Tabs reorder by dragging one onto another, the way VS Code's do. The
              // drag carries the view id; the drop renumbers the region's visible list.
              draggable: true,
              onDragStart: (event: DragEvent) => {
                event.dataTransfer?.setData("text/plain", viewId);
              },
              onDragOver: (event: DragEvent) => {
                // A drop target has to refuse the default to be droppable at all.
                event.preventDefault();
              },
              onDrop: (event: DragEvent) => {
                event.preventDefault();
                const dragged = event.dataTransfer?.getData("text/plain");
                if (!dragged) return;
                store.update((current) => reorderTab(current, regionId, dragged, viewId));
              },
              // **A click changes which tab is front, never the strip's order**: VS Code's
              // tabs stay where they were opened, and merging the two made prac's strip
              // MRU (the activated tab jumped to the first position and stayed there).
              onClick: () => store.update((current) => setFront(current, viewId)),
              "data-prac-tab-dirty": state.views[viewId]?.flags?.dirty === true ? "true" : "false",
              "data-prac-tab-preview":
                state.views[viewId]?.flags?.preview === true ? "true" : "false",
              style: {
                ...TAB_STYLE,
                ...(viewId === active ? TAB_ACTIVE_STYLE : {}),
                // VS Code's preview tab: the label is italic until the file is
                // pinned. The dot is the unsaved marker.
                ...(state.views[viewId]?.flags?.preview === true ? { fontStyle: "italic" } : {}),
              },
            },
            ...(state.views[viewId]?.flags?.dirty === true
              ? [createElement("span", { key: "dirty", style: TAB_DIRTY_STYLE }, "\u25cf")]
              : []),
            viewLabel(viewId),
            // The close affordance the view's declarer asked for. The frame reports the
            // request and nothing else: what "closed" means is the declarer's (for a
            // file, closing the app's editor retracts its view).
            ...(state.views[viewId]?.flags?.closable === true
              ? [
                  createElement(
                    "span",
                    {
                      key: "close",
                      "data-prac-tab-close": viewId,
                      title: "Close",
                      style: TAB_CLOSE_STYLE,
                      onClick: (event: MouseEvent) => {
                        // The tab itself fronts its view on click; closing must not.
                        event.stopPropagation();
                        store.requestCloseView(viewId);
                      },
                    },
                    "\u00d7",
                  ),
                ]
              : []),
          ),
        ),
        createElement("span", { key: "filler", style: { flex: "1 1 auto" } }),
      );
    };

    /**
     * One view's body, sized to the region's box.
     *
     * @param viewId - the view to render.
     * @param box - the box of the region holding it.
     */
    const viewBody = (viewId: string, box: Box, chrome?: "frame"): ReactElement =>
      createElement(
        IsolatedView,
        { key: viewId, ...(chrome === undefined ? {} : { chrome }) },
        createElement(View, {
          viewId,
          renderSlot,
          box,
          viewportWidth: state.viewportWidth,
        }),
      );

    /**
     * The **container bar**: one entry per child of a selector region.
     *
     * It is the switcher an activity bar would otherwise be. prac does not
     * inherit that chrome, so the container names live at the top of the region
     * they select — the same "one of N" idea as a tab strip, one level up.
     *
     * @param node - the selector region.
     * @param activeId - the child currently shown.
     */
    /**
     * The pane shown when a container is picked but has nothing visible in it.
     *
     * An empty region is not rendered (H1), so without this the track would fall back to another
     * container and the click would look like it went somewhere else.
     *
     * @param id - the container that was picked.
     */
    const emptyPane = (id: string): ReactElement =>
      createElement(
        "div",
        {
          key: `empty:${id}`,
          "data-prac-empty-pane": id,
          // VS Code's own presentation for an empty pane: a centred message with a 12px margin
          // (`paneCompositePart.css:365-384`). No dimming — upstream lets it inherit the foreground.
          style: {
            display: "flex",
            flex: "1 1 auto",
            alignItems: "center",
            alignContent: "center",
            justifyContent: "center",
            minHeight: 0,
            width: "100%",
          },
        },
        createElement(
          "span",
          { style: { margin: "12px", textAlign: "center" } },
          // VS Code's wording, verbatim (`paneCompositePart.ts:260`, `pane.emptyMessage`).
          "Drag a view here to display.",
        ),
      );

    const containerBar = (node: RegionNode, activeId: string): ReactElement =>
      createElement(
        "div",
        { key: "containers", "data-prac-container-bar": node.id, style: TAB_STRIP_STYLE },
        (node.children ?? []).map((child) =>
          createElement(
            "button",
            {
              key: child.id,
              type: "button",
              "data-prac-container": child.id,
              "data-prac-container-active": child.id === activeId ? "true" : "false",
              // An entry whose container has nothing visible is **shown** as empty rather than
              // silently skipped: clicking it still selects it, and the pane says so.
              "data-prac-container-empty": isPresent(state, child) ? "false" : "true",
              ...(isPresent(state, child) ? {} : { title: "Nothing in this container yet" }),
              onClick: () =>
                store.update((current) => {
                  const tree = selectChild(current.tree, node.id, child.id);
                  return tree === current.tree ? current : { ...current, tree };
                }),
              style: {
                ...TAB_STYLE,
                ...(child.id === activeId ? TAB_ACTIVE_STYLE : {}),
                ...(isPresent(state, child) ? {} : { opacity: 0.55 }),
              },
            },
            // Either shape may carry the name (a child that became a stack is a split — see
            // `SplitNode.label`), and the id is only the last resort.
            child.label ?? viewLabel(child.id),
          ),
        ),
      );

    /**
     * A region renders the child it selects, or — when it holds views — its
     * front-most visible view: a **stack** shows every visible view with a header
     * of its own, and a stack of one renders bare, so a single-view region looks
     * and measures exactly as it did before stacking existed.
     *
     * @param node - the region to render.
     * @param dir - the parent split's axis.
     */
    /**
     * A stack row's header: the fold switch and the title.
     *
     * A row is a leaf region that holds exactly one view (`node.entry`), so its header belongs to
     * the region and the fold is the region's `collapsed` — the height it remembers rides along in
     * `cachedSize`, the same two-field rule a folded row has everywhere else.
     */
    const entryHeader = (node: RegionNode, viewId: string): ReactElement =>
      createElement(
        "div",
        {
          "data-prac-stack-header": node.id,
          style: { ...STACK_HEADER_STYLE, display: "flex", alignItems: "center", gap: "2px" },
        },
        createElement(
          "button",
          {
            type: "button",
            // Readers find a row's switch by the **view** it shows (the handler uses the region).
            "data-prac-stack-toggle": viewId,
            "aria-expanded": node.collapsed === true ? "false" : "true",
            title: node.collapsed === true ? "Expand" : "Collapse",
            onClick: (event: ReactMouseEvent<HTMLElement>) => {
              const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
              const height = row?.getBoundingClientRect().height;
              store.update((current) =>
                setEntryFolded(current, node.id, node.collapsed !== true, height),
              );
            },
            style: {
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0 2px",
              font: "inherit",
            },
          },
          node.collapsed === true ? "\u25b8" : "\u25be",
        ),
        viewIconNode(viewId),
        createElement(
          "span",
          {
            "data-prac-stack-title": node.id,
            onPointerDownCapture: (event: PointerDragEvent) => {
              if (event.button !== 0) return;
              const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
              beginReorder(event, node.id, row?.parentElement ?? null);
            },
            style: {
              flex: "1 1 auto",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          viewLabel(viewId),
        ),
      );

    /**
     * The frame's controls over a view that already brings its own pane header.
     *
     * B owns the title: a `vscode:*` row keeps its VS Code pane header (title + actions) and the
     * frame draws only the fold switch and the title drag area on top of it. The strip is
     * transparent and stops before the pane's action buttons, so the one title stays the pane's.
     *
     * @param node - the stack row.
     * @param viewId - the view on the row.
     */
    const entryOverlay = (node: RegionNode, viewId: string): ReactElement =>
      createElement(
        "div",
        {
          "data-prac-stack-overlay": node.id,
          style: {
            position: "absolute",
            // Start below the sash: the boundary strip owns the row's first SASH_SIZE pixels, and
            // an overlay on top of it would swallow the boundary drag.
            top: SASH_SIZE,
            left: 0,
            right: "120px",
            height: STACK_HEADER_HEIGHT,
            zIndex: 6,
            display: "flex",
            alignItems: "center",
            gap: "2px",
          },
        },
        createElement(
          "button",
          {
            type: "button",
            "data-prac-stack-toggle": viewId,
            "aria-expanded": node.collapsed === true ? "false" : "true",
            title: node.collapsed === true ? "Expand" : "Collapse",
            onClick: (event: ReactMouseEvent<HTMLElement>) => {
              const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
              const height = row?.getBoundingClientRect().height;
              store.update((current) =>
                setEntryFolded(current, node.id, node.collapsed !== true, height),
              );
            },
            style: {
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0 2px",
              font: "inherit",
            },
          },
          node.collapsed === true ? "\u25b8" : "\u25be",
        ),
        createElement(
          "span",
          {
            "data-prac-stack-title": node.id,
            onPointerDownCapture: (event: PointerDragEvent) => {
              if (event.button !== 0) return;
              const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
              beginReorder(event, node.id, row?.parentElement ?? null);
            },
            style: {
              flex: "1 1 auto",
              height: "100%",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          viewLabel(viewId),
        ),
      );

    const renderRegion = (node: RegionNode, dir: Dir, fill = false): ReactElement => {
      const box = sizes.get(node.id) ?? ZERO_BOX;
      const child = activeChild(state, node);
      const chosen = chosenChild(state, node);
      // The pane follows what was **picked**: a container with nothing in it says so, instead of the
      // track quietly rendering a different container. The fallback still covers the other case — the
      // record names nothing that is in the tree any more — where there is nothing to name a pane after.
      const shown = chosen ?? child;
      if (shown !== null) {
        return createElement(
          "div",
          {
            key: node.id,
            "data-prac-region": node.id,
            style: regionStyle(
              node,
              dir,
              fill,
              node.entry === true ? sizes.get(node.id)?.height : undefined,
            ),
          },
          [
            // The bar marks what the person **picked**; when nothing of it is on screen the pane
            // below says why instead of the track quietly showing a different container.
            (node.children?.length ?? 0) > 1 ? containerBar(node, shown.id) : null,
            chosen !== null && !isPresent(state, chosen)
              ? emptyPane(chosen.id)
              : child === null
                ? null
                : // The chosen child may be a split (a stack took a region's place in this list).
                  child.type === "split"
                  ? renderNode(child, dir)
                  : renderRegion(child, dir, true),
          ],
        );
      }
      const views = visibleViews(state, node.id);
      const sashState: EntrySashState =
        node.entry === true ? entrySashState(state, node.id, rowHeights) : "disabled";
      return createElement(
        "div",
        {
          key: node.id,
          "data-prac-region": node.id,
          // A stack row is a region too: carry the entry markers so the frame's DOM-based helpers
          // (`readStackRows`, the reorder gesture, the gates) see a row where they expect one.
          ...(node.entry === true
            ? {
                // A row's bottom `SASH_SIZE` px is the boundary — the design says a row's bottom
                // edge **is** it, and the frame draws a sash there as well. Both call one starter.
                onPointerDownCapture: (event: PointerDragEvent) => {
                  if (event.button !== 0) return;
                  const element = event.currentTarget as unknown as HTMLElement;
                  const rect = element.getBoundingClientRect();
                  if (event.clientY < rect.bottom - SASH_SIZE) return;
                  const container = element.parentElement;
                  if (container === null) return;
                  // The **last** row has no boundary (B7), and a `Disabled` one must not start a
                  // drag at all — no resize, no fallback. Only `Enabled`/`AtMinimum`/`AtMaximum`
                  // reach the starter.
                  const rows = readStackRows(container as unknown as StackContainer);
                  const at = rows.findIndex((row) => row.viewId === node.id);
                  if (at < 0 || at >= rows.length - 1) return;
                  const state = entrySashState(
                    store.get(),
                    node.id,
                    new Map(rows.map((row) => [row.viewId, row.height])),
                  );
                  if (state === "disabled") return;
                  startEntryDrag(
                    store,
                    container as unknown as StackContainer,
                    node.id,
                    event.pointerId,
                    event.clientY,
                    element,
                  );
                  event.preventDefault();
                },
                onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
                  // The boundary is this row's bottom edge, so a double-click here resets the pair the
                  // way a double-click on the sash does (design B5).
                  const element = event.currentTarget as HTMLElement;
                  const rect = element.getBoundingClientRect();
                  if (event.clientY < rect.bottom - SASH_SIZE) return;
                  const container = element.parentElement;
                  if (container === null) return;
                  const reset = resetStackBoundary(
                    readStackRows(container as unknown as StackContainer),
                    node.id,
                  );
                  store.update((next) => {
                    let out = next;
                    for (const { viewId, height } of reset)
                      out = setEntryHeight(out, viewId, height);
                    return out;
                  });
                },
                // `data-prac-stack-entry` carries the **view** id (every gate and probe reads it that
                // way); the frame's own helpers key on the region, in `data-prac-stack-row`.
                "data-prac-stack-entry": views[0] ?? "",
                "data-prac-stack-row": node.id,
                // The boundary under this row follows `SashState` (B2/B4): `Disabled` has no handle
                // or resize cursor; `AtMinimum`/`AtMaximum` keep the handle and a **directional**
                // cursor; `Enabled` is the ordinary resize. Readers ask with these markers.
                "data-prac-stack-handle": sashState === "disabled" ? "false" : "true",
                "data-prac-stack-sash-state": sashState,
                "data-prac-stack-collapsed": node.collapsed === true ? "true" : "false",
              }
            : {}),
          style: {
            ...regionStyle(
              node,
              dir,
              fill,
              // A row is drawn at its allocated extent (C6/C8): the gain a region made belongs to one
              // row, and the allocation is what says which.
              node.entry === true ? sizes.get(node.id)?.height : undefined,
            ),
            // The B overlay is absolute inside its row; the row is the containing block.
            ...(node.entry === true &&
            views.length === 1 &&
            node.collapsed !== true &&
            viewSource(views[0] ?? "") === "vscode:"
              ? { position: "relative" }
              : {}),
          },
        },
        showsTabStrip(state, node)
          ? [tabStrip(views, node.id), viewBody(frontView(state, node.id) ?? views[0] ?? "", box)]
          : node.entry === true && views.length === 1
            ? (() => {
                const viewId = views[0] ?? "";
                const stackBody =
                  node.collapsed === true
                    ? null
                    : createElement(
                        "div",
                        {
                          "data-prac-stack-body": node.id,
                          style: {
                            display: "flex",
                            flexDirection: "column",
                            flex: "1 1 auto",
                            minHeight: 0,
                            position: "relative",
                            overflow: "hidden",
                          },
                        },
                        viewBody(
                          viewId,
                          box,
                          viewSource(viewId) === "vscode:" ? "frame" : undefined,
                        ),
                      );
                // B: a view with its own pane header owns the row title. The expanded row is just
                // the view plus the frame's fold/drag overlay; a folded row has no view, so the
                // frame's own header (with the declared title) is what remains.
                if (viewSource(viewId) === "vscode:") {
                  return node.collapsed === true
                    ? [entryHeader(node, viewId)]
                    : [stackBody, entryOverlay(node, viewId)];
                }
                return [entryHeader(node, viewId), stackBody];
              })()
            : // No strip: the region still shows its **front** view. It used to take the
              // first by order, which is a different question — measured with a region a view
              // had just been split into: the file that was copied in was front, the
              // region rendered its neighbour, and the new file's view got no surface.
              [viewBody(frontView(state, node.id) ?? views[0] ?? "", box)],
      );
    };

    /**
     * Recursive: a split overlays its present children's boundaries with sashes.
     *
     * @param node - the subtree to render.
     * @param dir - the parent split's axis.
     */
    const renderNode = (node: LayoutNode, dir: Dir): ReactElement => {
      if (node.type === "region") return renderRegion(node, dir);
      const present = node.children.filter((child) => isPresent(state, child));
      const parts: ReactElement[] = [];
      // The sashes are absolutely positioned, so the children flow edge to edge and the boundary
      // offset is the sum of the extents before it (the allocation, not the DOM).
      let offset = 0;
      present.forEach((child, index) => {
        if (index > 0) {
          const before = edgeRegion(state, present[index - 1], "right");
          const after = edgeRegion(state, child, "left");
          if (before && after) {
            parts.push(
              createElement(Sash, {
                key: `sash:${node.id}:${index}`,
                store,
                splitId: node.id,
                dir: node.dir,
                index,
                leftId: before.id,
                rightId: after.id,
                offset,
                ...(before.entry === true && after.entry === true
                  ? { stackState: entrySashState(state, before.id, rowHeights) }
                  : {}),
              }),
            );
          }
        }
        parts.push(renderNode(child, node.dir));
        const box = sizes.get(child.id);
        offset += node.dir === "row" ? (box?.width ?? 0) : (box?.height ?? 0);
      });
      return createElement(
        "div",
        {
          key: node.id,
          "data-prac-split": node.id,
          "data-prac-split-dir": node.dir,
          style: splitStyle(node),
        },
        parts,
      );
    };

    return createElement(
      "div",
      {
        ref: frameRef,
        "data-prac-frame": "",
        style: {
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        },
      },
      createElement(DocumentTitle, {
        productTitle: PRODUCT_TITLE,
        useSessions,
        usePanelInfo,
        currentSession: sources.currentSession,
      }),
      renderNode(state.tree, "row"),
      // The overlay layer: above every region, click-through until an
      // entry opts into pointer events (see FRAME_STYLES).
      createElement(
        "div",
        {
          "data-prac-overlay-layer": "",
          style: { position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" },
        },
        // The float layer is a surface plane too: its entries live inside their own
        // isolation root, while the box itself stays click-through.
        createElement(IsolatedView, { clickThrough: true }, renderSlot("shell.overlay", {})),
      ),
    );
  };
}

// ── document title ────────────────────────────────────────────────────

/** The product title the page shipped with, restored when no session is shown. */
const PRODUCT_TITLE = document.title;

/** Props of the (render-less) document-title component. */
interface DocumentTitleProps {
  useSessions: UseSessions;
  usePanelInfo: UsePanelInfo;
  currentSession: CurrentSessionSource;
  productTitle: string;
}

/**
 * Project the active session title into the browser title.
 *
 * @param props - the session/panel hooks and the product title to fall back to.
 */
function DocumentTitle({
  useSessions,
  usePanelInfo,
  currentSession,
  productTitle,
}: DocumentTitleProps): null {
  const sessionKey = useSyncExternalStore(
    (listener) => currentSession.subscribe(listener),
    () => currentSession.getSnapshot().key,
  );
  const showSessionTitle = usePanelInfo((info) => info.activePanelId === null);
  const title = useSessions((sessionState) => {
    if (!showSessionTitle || sessionKey === undefined) return undefined;
    // The list's `byId` is keyed by the branded session id, and this key is that id: the
    // index is read through a plain-string view of the same table.
    const rows = sessionState.byId as Readonly<Record<string, { readonly title?: string }>>;
    return rows[sessionKey]?.title;
  });
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`;
    return () => {
      document.title = productTitle;
    };
  }, [productTitle, title]);
  return null;
}
