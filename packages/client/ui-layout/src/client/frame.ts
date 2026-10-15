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
  activeChild,
  edgeRegion,
  findRegion,
  findSplit,
  isPresent,
  frontView,
  isStacked,
  resolveSizes,
  setFront,
  sashSizes,
  selectChild,
  setRegionSize,
  showsTabStrip,
  subtreeMin,
  visibleViews,
  allocateStack,
  MIN_ENTRY,
  HEADER_HEIGHT,
  redistributeOnDrag,
  setViewCollapsed,
  dragSnapTarget,
  dragChainTarget,
  moveViewInRegion,
  resetStackBoundary,
} from "./model.js";
import { type LayoutStore, useLayout } from "./store.js";
import type { LayoutState } from "./contract.js";

/** A minimal pointer event, as the sash drag machine reads it. */
interface PointerDragEvent {
  readonly pointerId: number;
  readonly button: number;
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
}: {
  children?: ReactNode;
  /** The box itself lets events pass; its entries opt back in (the float layer). */
  clickThrough?: boolean;
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

/** A view's display label: the tail of its id (`dsh:sidebar` → `sidebar`). */
function viewLabel(viewId: string): string {
  return (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");
}

/** The header a stacked view carries: its label plus a fold toggle. */

const STACK_HEADER_STYLE: StyleObject = {
  display: "block",
  height: HEADER_HEIGHT,
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
  flex: "0 0 auto",
  overflow: "hidden",
  background: "rgba(127,127,127,0.10)",
};

/** One tab. */
const TAB_STYLE: StyleObject = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  padding: "5px 10px",
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

/** Whether two measurement maps say the same thing. */
function sameSizes(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}
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

let entryDrag: {
  viewId: string;
  pointerId: number;
  origin: number;
  start: number;
  limit: number;
  /** Every entry of this stack, top-down: the ones below give up the room a drag takes. */
  peers: { viewId: string; height: number }[];
  /** The same entries including the folded ones, which a snap has to be able to open. */
  rows: { viewId: string; height: number; folded: boolean }[];
  /** The element the entries live in, so a snap can re-read the stack it just changed. */
  container: { querySelectorAll(selectors: string): readonly StackEntryNode[] } | null;
  /** What every entry measured when the drag began: the height a folded entry comes back at. */
  startRows: { viewId: string; height: number }[];
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
    viewId: node.getAttribute("data-prac-stack-entry") ?? "",
    height: Math.round(node.getBoundingClientRect().height),
    folded: node.getAttribute("data-prac-stack-collapsed") === "true",
  }));
}

/** One in-flight sash drag. */
interface DragState {
  pointerId: number;
  /** Pointer position along the split axis when the drag started. */
  origin: number;
  a: RegionNode;
  b: RegionNode;
  /** The extent this pair may share (see {@link sashSizes}). */
  budget: number;
}

/** Props of one draggable boundary. */
interface SashProps {
  store: LayoutStore;
  splitId: string;
  dir: Dir;
  index: number;
  leftId: string;
  rightId: string;
}

/**
 * A draggable boundary between two adjacent regions.
 *
 * Plain pointer events with capture: `pointerdown` records the two
 * neighbours and the split's measured extent, `pointermove` translates the
 * pointer delta into a size change, `pointerup` ends it. The rule set is the
 * one the spec fixes: fixed|fixed grows one and shrinks the other;
 * fixed|flex changes the fixed one; flex|flex does nothing. The flex side
 * keeps its own minimum, so a fixed neighbour can never squeeze it away.
 *
 * @param props - the boundary's identity and the two regions it separates.
 */
function Sash({ store, splitId, dir, index, leftId, rightId }: SashProps): ReactElement {
  const drag = useRef<DragState | null>(null);

  const onPointerDown = (event: PointerDragEvent): void => {
    if (event.button !== 0) return;
    const state = store.get();
    const split = findSplit(state.tree, splitId);
    const a = findRegion(state.tree, leftId);
    const b = findRegion(state.tree, rightId);
    if (!split || !a || !b || a.collapsed || b.collapsed) return;
    const element = event.currentTarget;
    const container = element.parentElement;
    const extent = dir === "row" ? container!.clientWidth : container!.clientHeight;
    const present = split.children.filter((child) => isPresent(state, child));
    const sashes = Math.max(0, present.length - 1) * SASH_SIZE;
    // Every *other* child keeps its minimum: clamping against the adjacent
    // region alone lets a growing fixed region starve its flex siblings to zero.
    const reserve = present
      .filter((child) => child.id !== leftId && child.id !== rightId)
      .reduce((total, child) => total + subtreeMin(child), 0);
    drag.current = {
      pointerId: event.pointerId,
      origin: dir === "row" ? event.clientX : event.clientY,
      a,
      b,
      budget: Math.max(a.min + b.min, extent - sashes - reserve),
    };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerDragEvent): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = dir === "row" ? event.clientX : event.clientY;
    const next = sashSizes(current.a, current.b, point - current.origin, current.budget);
    if (!next) return;
    store.update((state) => {
      let tree = state.tree;
      if (next.a !== undefined) tree = setRegionSize(tree, current.a.id, next.a);
      if (next.b !== undefined) tree = setRegionSize(tree, current.b.id, next.b);
      return tree === state.tree ? state : { ...state, tree };
    });
  };

  const onPointerUp = (event: PointerDragEvent): void => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return createElement("div", {
    "data-prac-sash": `${splitId}:${index}`,
    "data-prac-sash-dir": dir,
    "data-prac-sash-left": leftId,
    "data-prac-sash-right": rightId,
    "aria-hidden": "true",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  });
}

/** Frame-wide rules that cannot be expressed as inline styles on rendered entries. */
const FRAME_STYLES = `
[data-prac-overlay-layer] { display: flex; flex-direction: column; }
[data-prac-overlay-layer] > * { pointer-events: auto; }
[data-prac-region] { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
[data-prac-region] > * { flex: 1 1 auto; min-height: 0; }
[data-prac-sash] { flex: 0 0 ${SASH_SIZE}px; position: relative; z-index: 5; touch-action: none; user-select: none; background: transparent; }
[data-prac-sash][data-prac-sash-dir="row"] { cursor: col-resize; }
[data-prac-sash][data-prac-sash-dir="column"] { cursor: row-resize; }
[data-prac-sash]:hover { background: rgba(127, 127, 127, 0.35); }
[data-prac-stack-entry]::after { content: ""; cursor: row-resize; position: absolute; left: 0; right: 0; bottom: 0; height: ${SASH_SIZE}px; z-index: 5; cursor: row-resize; }
[data-prac-stack-entry]:hover::after { background: rgba(127, 127, 127, 0.35); }
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
function regionStyle(node: RegionNode, dir: Dir, fill = false): StyleObject {
  if (node.collapsed) return { flex: "0 0 0px", minWidth: 0, minHeight: 0, overflow: "hidden" };
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
  if (node.flex) return { flex: "1 1 0", ...minimum, overflow: "hidden", ...stack };
  return { flex: `0 0 ${node.size}px`, ...minimum, overflow: "hidden", ...stack };
}

/**
 * A split's flex container: one axis, with children sized by their own basis.
 *
 * @param node - the split to style.
 */
function splitStyle(node: SplitNode): StyleObject {
  return {
    display: "flex",
    flexDirection: node.dir === "row" ? "row" : "column",
    flex: "1 1 0",
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

    // Track the frame's own box (not the window).
    /** What each stack entry measured on the previous frame (see `allocateStack`). */
    const measuredEntries = useRef<Map<string, number>>(new Map());
    /**
     * What each region measured.
     *
     * `allocateStack` needs the height the stack **really** has: the frame's own size table comes
     * from the previous frame and a stack that overflowed once keeps reporting the too-large
     * number (measured: 756 against a region that is 734 tall).
     */
    const measuredRegions = useRef<Map<string, number>>(new Map());
    /** Bumped when the measurements changed, so the allocation runs again with the real numbers. */
    const [measureVersion, setMeasureVersion] = useState(0);
    void measureVersion;
    useLayoutEffect(() => {
      const entries = new Map<string, number>();
      for (const node of document.querySelectorAll<HTMLElement>("[data-prac-stack-entry]")) {
        const viewId = node.getAttribute("data-prac-stack-entry");
        if (viewId !== null) entries.set(viewId, Math.round(node.getBoundingClientRect().height));
      }
      const regions = new Map<string, number>();
      for (const node of document.querySelectorAll<HTMLElement>("[data-prac-region]")) {
        const regionId = node.getAttribute("data-prac-region");
        if (regionId !== null)
          regions.set(regionId, Math.round(node.getBoundingClientRect().height));
      }
      const changed =
        !sameSizes(entries, measuredEntries.current) ||
        !sameSizes(regions, measuredRegions.current);
      measuredEntries.current = entries;
      measuredRegions.current = regions;
      if (changed) setMeasureVersion((version) => version + 1);
    });
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
    const beginReorder = (down: PointerDragEvent, viewId: string): void => {
      const container = (down.currentTarget as HTMLElement).parentElement;
      if (container === null) return;
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
            id: element.getAttribute("data-prac-stack-entry") ?? "",
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
            setViewCollapsed(state, viewId, state.views[viewId]?.collapsed !== true, height),
          );
          return;
        }
        if (target === null || target.reference === viewId) return;
        store.update((state) =>
          moveViewInRegion(state, viewId, target.reference, target.direction),
        );
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", drop);
      down.preventDefault();
    };

    const stackEntry = (
      viewId: string,
      box: Box,
      handle: boolean,
      allocated: number | undefined = undefined,
    ): ReactElement => {
      const collapsed = state.views[viewId]?.collapsed === true;
      const size = allocated ?? state.views[viewId]?.size;
      // The bottom `SASH_SIZE` px of the entry are its resize handle — **no extra element
      // anywhere**, so the stack's children stay exactly its entries and the view body keeps its
      // shape. The listener is on the **capture** phase: the press lands on the view's own DOM
      // (the workbench's tree), which is free to `stopPropagation`, and a bubbling listener
      // would never hear about it.
      /**
       * A double-click on the boundary (its bottom `SASH_SIZE` px) evens out the two rows it
       * separates — upstream's sash reset (`onDidReset`, `splitview.ts:1186`), which also refuses
       * when a whole side is folded. A double-click anywhere else on the entry does nothing.
       */
      const onDoubleClickCapture = (event: PointerDragEvent): void => {
        if (event.button !== 0) return;
        const element = event.currentTarget as HTMLElement;
        const rect = element.getBoundingClientRect();
        if (event.clientY < rect.bottom - SASH_SIZE) return;
        const reset = resetStackBoundary(
          readStackRows(element.parentElement as unknown as StackContainer),
          viewId,
        );
        if (reset.length === 0) return;
        store.update((state) => {
          const views = { ...state.views };
          for (const { viewId: id, height } of reset) {
            const view = views[id];
            if (view !== undefined && view.collapsed !== true)
              views[id] = { ...view, size: height };
          }
          return { ...state, views };
        });
      };

      const onPointerDownCapture = (event: PointerDragEvent): void => {
        // Only an entry with an entry **below** it has a boundary to drag: the stack's last
        // entry ends at the stack's own edge, where a drag has nothing to give (and would eat
        // the bottom 5px of the view's content).
        if (event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        // The bottom `SASH_SIZE` px is the resizing sash; the fold switch is the button. Everywhere
        // else on the header row is the reorder handle (upstream's sash is its own element and takes
        // precedence where it overlaps, `splitview.ts:1168-1173`).
        if (event.clientY >= rect.bottom - SASH_SIZE) {
          if (!handle) return;
          // A boundary that can move nothing is not draggable (B4): both sides are folded or already
          // at their floor. `redistributeOnDrag` reports only the rows that would actually move.
          const here = readStackRows(
            (event.currentTarget as HTMLElement).parentElement as unknown as StackContainer,
          );
          if (
            [...redistributeOnDrag(here, viewId, 1)].length === 0 &&
            [...redistributeOnDrag(here, viewId, -1)].length === 0
          ) {
            return;
          }
        } else {
          // Only the header row is a handle. A press in the entry's **body** belongs to the view
          // (the file tree, the editor) and must not be swallowed: doing that made a click in the
          // content fold the entry (caught by verify:timeline).
          const target = (event as unknown as { target: EventTarget | null }).target;
          const header =
            target instanceof HTMLElement ? target.closest("[data-prac-stack-header]") : null;
          if (header === null) return;
          const onToggle =
            target instanceof HTMLElement ? target.closest("[data-prac-stack-toggle]") : null;
          if (onToggle !== null) return;
          beginReorder(event, viewId);
          return;
        }
        // The move/up listeners go on the **window**: a store update re-renders the frame and
        // the entry element can be replaced mid-drag, dropping pointer capture.
        const move = (moveEvent: PointerEvent): void => {
          if (entryDrag === null || entryDrag.pointerId !== moveEvent.pointerId) return;
          moveEvent.preventDefault();
          const drag = entryDrag;
          const pointerDelta = moveEvent.clientY - drag.origin;
          const snap =
            dragSnapTarget(drag.rows, drag.viewId, pointerDelta) ??
            // No threshold crossed yet: when the entries below have no room left, the drag keeps
            // going by folding the next one down (the chain the person described: file view, open
            // editors, timeline), while the entries above are never touched.
            ((): { viewId: string; collapsed: boolean } | undefined => {
              const chain = dragChainTarget(
                drag.rows,
                drag.viewId,
                Math.round(drag.start + pointerDelta),
              );
              return chain === undefined ? undefined : { viewId: chain, collapsed: true };
            })();
          if (snap !== undefined) {
            // Upstream snaps a view in or out and then lays the split view out again with the new
            // visibility (`splitview.ts:1298-1307`). Same here: fold it, re-read the stack and
            // re-anchor the drag, so the band is measured from where the stack now is.
            // Folding remembers the height the entry had when the **drag began**, the way upstream
            // hands `setVisible` the size captured at drag start (`splitview.ts:946`) — not the
            // height it was squeezed to by the time the threshold was crossed.
            const atStart = drag.startRows.find((row) => row.viewId === snap.viewId)?.height;
            store.update((state) => {
              const folded = setViewCollapsed(state, snap.viewId, snap.collapsed);
              const view = folded.views[snap.viewId];
              return view === undefined || atStart === undefined || view.size === atStart
                ? folded
                : {
                    ...folded,
                    views: { ...folded.views, [snap.viewId]: { ...view, size: atStart } },
                  };
            });
            // The fold only reaches the DOM on the next render, so the immediately re-read rows
            // still show the entry as it was: drop the one just folded by hand, or the very next
            // move would resize it as if it were an ordinary entry (measured: it wrote the folded
            // entry's floor over the height it was folded with — 107 became 48).
            const rows = readStackRows(drag.container).filter(
              (row) => !row.folded && !(snap.collapsed && row.viewId === snap.viewId),
            );
            drag.rows = rows;
            drag.peers = rows;
            // And read the stack once more after the render, so an entry the drag just opened
            // joins the arithmetic too.
            requestAnimationFrame(() => {
              if (entryDrag !== drag) return;
              const settled = readStackRows(drag.container);
              drag.rows = settled;
              drag.peers = settled.filter((row) => !row.folded);
            });
            drag.start = rows.find((row) => row.viewId === drag.viewId)?.height ?? drag.start;
            drag.origin = moveEvent.clientY;
            const below = drag.peers.slice(
              drag.peers.findIndex((peer) => peer.viewId === drag.viewId) + 1,
            );
            drag.limit = Math.max(
              MIN_ENTRY,
              drag.start +
                below.reduce((total, peer) => total + Math.max(0, peer.height - MIN_ENTRY), 0),
            );
            return;
          }
          const wanted = Math.round(drag.start + pointerDelta);
          const target = Math.max(MIN_ENTRY, Math.min(drag.limit, wanted));
          // Upstream's rule (`SplitView.resize`): the dragged entry and the ones above it take the
          // delta, the ones below give it up — several sizes move, and the stack keeps its height.
          const sizes = redistributeOnDrag(drag.rows, drag.viewId, target);
          store.update((state) => {
            let views = state.views;
            let changed = false;
            for (const [id, size] of sizes) {
              const view = views[id];
              if (view === undefined || view.size === size) continue;
              if (!changed) {
                views = { ...views };
                changed = true;
              }
              views[id] = { ...view, size };
            }
            return changed ? { ...state, views } : state;
          });
        };
        const finish = (upEvent: PointerEvent): void => {
          if (entryDrag === null || entryDrag.pointerId !== upEvent.pointerId) return;
          entryDrag = null;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
        };
        // Read the stack as it stands: a drag takes room from the entries **below** it, each
        // down to its floor, and the new sizes are written back together — so the entries always
        // add up to the stack and no later pass has to clamp anything (upstream's rule, see the
        // worklog: the drag is bounded by the neighbours' own slack).
        const container = event.currentTarget.parentElement;
        const all = [...(container?.querySelectorAll("[data-prac-stack-entry]") ?? [])].map(
          (node) => ({
            viewId: node.getAttribute("data-prac-stack-entry") ?? "",
            height: Math.round(node.getBoundingClientRect().height),
            /** A folded entry is a header: it owns no height to give and must not be written to. */
            folded: node.getAttribute("data-prac-stack-collapsed") === "true",
          }),
        );
        const self = all.find((entry) => entry.viewId === viewId);
        // A folded entry has no body to drag, and its height is a header — writing a size for it
        // is what left an entry stuck at ~18px, unable to unfold again (measured).
        if (self === undefined || self.folded) return;
        const peers = all.filter((entry) => !entry.folded);
        const below = peers.slice(peers.findIndex((peer) => peer.viewId === viewId) + 1);
        const slack = below.reduce(
          (total, peer) => total + Math.max(0, peer.height - MIN_ENTRY),
          0,
        );
        // A drag needs somewhere to put (or take) room: either the entries below can give, or
        // this entry can shrink into them. With neither, the press belongs to the view under it.
        if (slack <= 0 && rect.height <= MIN_ENTRY + 1) return;
        entryDrag = {
          viewId,
          pointerId: event.pointerId,
          origin: event.clientY,
          start: rect.height,
          limit: Math.max(MIN_ENTRY, rect.height + slack),
          peers,
          rows: all,
          container: container ?? null,
          startRows: all.map((row) => ({ viewId: row.viewId, height: row.height })),
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        event.preventDefault();
      };
      return createElement(
        "div",
        {
          key: viewId,
          "data-prac-stack-entry": viewId,
          "data-prac-stack-handle": handle ? "true" : "false",
          onPointerDownCapture,
          "data-prac-stack-collapsed": collapsed ? "true" : "false",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onDoubleClick: onDoubleClickCapture as any,
          style: {
            // A person may have dragged this entry's bottom edge: then it keeps that height and
            // its neighbours share the rest. Otherwise every entry shares equally.
            position: "relative",
            flex: collapsed ? "0 0 auto" : size === undefined ? "1 1 0" : `0 0 ${size}px`,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        },
        createElement(
          "div",
          {
            key: "header",
            "data-prac-stack-header": viewId,
            style: { ...STACK_HEADER_STYLE, display: "flex", alignItems: "center", gap: "2px" },
          },
          createElement(
            "button",
            {
              key: "toggle",
              type: "button",
              "data-prac-stack-toggle": viewId,
              "aria-expanded": collapsed ? "false" : "true",
              title: collapsed ? "Expand" : "Collapse",
              onClick: (event: ReactMouseEvent<HTMLElement>) => {
                // What the entry is drawn at right now: the fold remembers it the way upstream's
                // hidden view keeps its size, so unfolding gives the same height back.
                const entry = (event.currentTarget as HTMLElement).closest(
                  "[data-prac-stack-entry]",
                );
                if (entry === null) return;
                const height = entry.getBoundingClientRect().height;
                store.update((current) =>
                  setViewCollapsed(
                    current,
                    viewId,
                    current.views[viewId]?.collapsed !== true,
                    height,
                  ),
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
            collapsed ? "\u25b8" : "\u25be",
          ),
          createElement(
            "span",
            {
              key: "title",
              "data-prac-stack-title": viewId,
              style: {
                flex: "1 1 auto",
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            `${state.views[viewId]?.flags?.dirty === true ? "\u25cf " : ""}${viewLabel(viewId)}`,
          ),
        ),
        collapsed
          ? null
          : createElement(
              "div",
              {
                key: "body",
                "data-prac-stack-body": viewId,
                // A **flex container**, not a block: the view host inside carries
                // `flex: 1 1 auto`, which is inert under a block parent — the host then
                // sizes to whatever its content reports and the pane collapses to its
                // header. Measured on a restored layout: entry 147 → body 129 → host 22
                // (a fresh page only looked right because the part inside reported a
                // height first). With the body flexible, the host takes the body's box
                // whatever the content measures.
                style: {
                  display: "flex",
                  flexDirection: "column",
                  flex: "1 1 auto",
                  minHeight: 0,
                  position: "relative",
                  overflow: "hidden",
                },
              },
              createElement(
                IsolatedView,
                null,
                createElement(View, {
                  viewId,
                  renderSlot,
                  box,
                  viewportWidth: state.viewportWidth,
                }),
              ),
            ),
      );
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
    const viewBody = (viewId: string, box: Box): ReactElement =>
      createElement(
        IsolatedView,
        { key: viewId },
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
              onClick: () =>
                store.update((current) => {
                  const tree = selectChild(current.tree, node.id, child.id);
                  return tree === current.tree ? current : { ...current, tree };
                }),
              style: { ...TAB_STYLE, ...(child.id === activeId ? TAB_ACTIVE_STYLE : {}) },
            },
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
    const renderRegion = (node: RegionNode, dir: Dir, fill = false): ReactElement => {
      const box = sizes.get(node.id) ?? ZERO_BOX;
      const child = activeChild(state, node);
      if (child !== null) {
        return createElement(
          "div",
          {
            key: node.id,
            "data-prac-region": node.id,
            style: regionStyle(node, dir, fill),
          },
          [
            (node.children?.length ?? 0) > 1 ? containerBar(node, child.id) : null,
            renderRegion(child, dir, true),
          ],
        );
      }
      const views = visibleViews(state, node.id);
      const stacked = isStacked(state, node);
      return createElement(
        "div",
        {
          key: node.id,
          "data-prac-region": node.id,
          style: regionStyle(node, dir, fill),
        },
        showsTabStrip(state, node)
          ? [tabStrip(views, node.id), viewBody(frontView(state, node.id) ?? views[0] ?? "", box)]
          : stacked
            ? (() => {
                // A plain stack shares the height through flex; once something is folded or sized
                // the distribution has to be explicit (`allocateStack`).
                const allocated = views.some(
                  (viewId) =>
                    state.views[viewId]?.size !== undefined ||
                    state.views[viewId]?.collapsed === true,
                )
                  ? allocateStack(
                      views,
                      state,
                      measuredEntries.current,
                      measuredRegions.current.get(node.id) ?? box.height,
                    )
                  : undefined;
                return views.map((viewId, position) =>
                  stackEntry(viewId, box, position < views.length - 1, allocated?.get(viewId)),
                );
              })()
            : // No strip: the region still shows its **front** view. It used to take the
              // first by order, which is a different question — measured with a region a
              // view had just been split into: the file that was copied in was front, the
              // region rendered its neighbour, and the new file's view got no surface.
              [viewBody(frontView(state, node.id) ?? views[0] ?? "", box)],
      );
    };

    /**
     * Recursive: a split interleaves its present children with sashes.
     *
     * @param node - the subtree to render.
     * @param dir - the parent split's axis.
     */
    const renderNode = (node: LayoutNode, dir: Dir): ReactElement => {
      if (node.type === "region") return renderRegion(node, dir);
      const present = node.children.filter((child) => isPresent(state, child));
      const parts: ReactElement[] = [];
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
              }),
            );
          }
        }
        parts.push(renderNode(child, node.dir));
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
