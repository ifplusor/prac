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

import { createElement, useEffect, useLayoutEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import type { UsePanelInfo } from "@deepseek-ai/dsh-client-ui-layout/client";
import type { UseSessions } from "@deepseek-ai/dsh-client-ui-session/client";
import {
  DSH_MAIN_PREFIX,
  DSH_RIGHTBAR_VIEW,
  DSH_SIDEBAR_VIEW,
  DSH_VIEW_SOURCE,
  VIEW_SEAT,
  isSeatView,
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
import {
  edgeRegion,
  findRegion,
  findSplit,
  isPresent,
  isStacked,
  resolveSizes,
  sashSizes,
  setRegionSize,
  subtreeMin,
  visibleViews,
} from "./model.js";
import { type LayoutStore, useLayout } from "./store.js";

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
    } | null;
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
 * `prac.view` seat declares renders that declaration (membership is read from the
 * registry — see {@link isSeatView}). Anything else renders nothing.
 *
 * @param props - the placed view's identity, slot face and region box.
 */
function View({ viewId, renderSlot, box, viewportWidth }: ViewProps): ReactNode {
  const source = viewSource(viewId);
  if (source === DSH_VIEW_SOURCE) return renderDshView(viewId, renderSlot, box, viewportWidth);
  if (isSeatView(viewId)) return renderSlot(VIEW_SEAT, {}, { only: viewId });
  return null;
}

/** A view's display label: the tail of its id (`dsh:sidebar` → `sidebar`). */
function viewLabel(viewId: string): string {
  return (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");
}

/** The header a stacked view carries: its label plus a fold toggle. */
const STACK_HEADER_STYLE: StyleObject = {
  display: "block",
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
[data-prac-overlay-layer] > * { pointer-events: auto; }
[data-prac-region] { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
[data-prac-region] > * { flex: 1 1 auto; min-height: 0; }
[data-prac-sash] { flex: 0 0 ${SASH_SIZE}px; position: relative; z-index: 5; touch-action: none; user-select: none; background: transparent; }
[data-prac-sash][data-prac-sash-dir="row"] { cursor: col-resize; }
[data-prac-sash][data-prac-sash-dir="column"] { cursor: row-resize; }
[data-prac-sash]:hover { background: rgba(127, 127, 127, 0.35); }
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
function regionStyle(node: RegionNode, dir: Dir): StyleObject {
  if (node.collapsed) return { flex: "0 0 0px", minWidth: 0, minHeight: 0, overflow: "hidden" };
  // The minimum is expressed on the split's own axis: a flex region with
  // `min-width: 0` can be squeezed to nothing by its siblings.
  const minimum = {
    minWidth: dir === "row" ? node.min : 0,
    minHeight: dir === "column" ? node.min : 0,
  };
  const stack: StyleObject =
    node.stack === true ? { display: "flex", flexDirection: "column" } : {};
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

/** Props DSH hands the root slot component. */
interface FrameProps {
  renderSlot: RenderSlot;
  useSessions: UseSessions;
  usePanelInfo: UsePanelInfo;
}

/**
 * The frame: the region tree, plus the frame-wide overlay layer.
 *
 * `shell.overlay` stays a layer rather than a region — it is the additive seat
 * for surfaces that float above every region.
 *
 * @param store - the layout store this frame renders.
 */
export function createFrame(store: LayoutStore): (props: FrameProps) => ReactElement {
  return function PracFrame({ renderSlot, useSessions, usePanelInfo }: FrameProps): ReactElement {
    const state = useLayout(store);
    const frameRef = useRef<HTMLDivElement | null>(null);

    // Track the frame's own box (not the window).
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
    const stackEntry = (viewId: string, box: Box): ReactElement => {
      const collapsed = state.views[viewId]?.collapsed === true;
      return createElement(
        "div",
        {
          key: viewId,
          "data-prac-stack-entry": viewId,
          "data-prac-stack-collapsed": collapsed ? "true" : "false",
          style: {
            flex: collapsed ? "0 0 auto" : "1 1 0",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        },
        createElement(
          "button",
          {
            key: "header",
            type: "button",
            "data-prac-stack-toggle": viewId,
            "aria-expanded": collapsed ? "false" : "true",
            onClick: () =>
              store.update((current) => {
                const view = current.views[viewId];
                if (!view) return current;
                return {
                  ...current,
                  views: {
                    ...current.views,
                    [viewId]: { ...view, collapsed: view.collapsed !== true },
                  },
                };
              }),
            style: STACK_HEADER_STYLE,
          },
          `${viewLabel(viewId)} ${collapsed ? "\u25b8" : "\u25be"}`,
        ),
        collapsed
          ? null
          : createElement(
              "div",
              {
                key: "body",
                "data-prac-stack-body": viewId,
                style: { flex: "1 1 auto", minHeight: 0, position: "relative", overflow: "hidden" },
              },
              createElement(View, {
                viewId,
                renderSlot,
                box,
                viewportWidth: state.viewportWidth,
              }),
            ),
      );
    };

    /**
     * A region renders its front-most visible view — or, when it is a **stack**
     * and holds more than one, every visible view with a header of its own. A
     * stack of one renders bare, so a single-view region looks and measures
     * exactly as it did before stacking existed.
     *
     * @param node - the region to render.
     * @param dir - the parent split's axis.
     */
    const renderRegion = (node: RegionNode, dir: Dir): ReactElement => {
      const box = sizes.get(node.id) ?? ZERO_BOX;
      const views = visibleViews(state, node.id);
      const stacked = isStacked(state, node);
      return createElement(
        "div",
        {
          key: node.id,
          "data-prac-region": node.id,
          style: regionStyle(node, dir),
        },
        stacked
          ? views.map((viewId) => stackEntry(viewId, box))
          : views.slice(0, 1).map((viewId) =>
              createElement(View, {
                key: viewId,
                viewId,
                renderSlot,
                box,
                viewportWidth: state.viewportWidth,
              }),
            ),
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
      createElement(DocumentTitle, { productTitle: PRODUCT_TITLE, useSessions, usePanelInfo }),
      renderNode(state.tree, "row"),
      // The overlay layer: above every region, click-through until an
      // entry opts into pointer events (see FRAME_STYLES).
      createElement(
        "div",
        {
          "data-prac-overlay-layer": "",
          style: { position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" },
        },
        renderSlot("shell.overlay", {}),
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
  productTitle: string;
}

/**
 * Project the active session title into the browser title.
 *
 * @param props - the session/panel hooks and the product title to fall back to.
 */
function DocumentTitle({ useSessions, usePanelInfo, productTitle }: DocumentTitleProps): null {
  const showSessionTitle = usePanelInfo((info) => info.activePanelId === null);
  const title = useSessions((sessionState) => {
    const current = sessionState.current;
    return !showSessionTitle || current === undefined
      ? undefined
      : sessionState.byId[current]?.title;
  });
  useEffect(() => {
    document.title = title === undefined ? productTitle : `${title} — ${productTitle}`;
    return () => {
      document.title = productTitle;
    };
  }, [productTitle, title]);
  return null;
}
