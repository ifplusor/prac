import {
  type GroupBarItem,
  SASH_SIZE,
  type StyleObject,
  setEntryFolded,
  setEntryHeight,
  place,
  setFront,
  type LayoutState,
  type LayoutStore,
  type ItemRecord,
} from "prac-ui-kit-workbench";
import type { WindowManager } from "./window-manager.js";
import {
  TabStrip,
  StackHeader,
  StackRowOverlay,
  LayoutSashDrag,
  GridCellHandles,
  GridTrackHandle,
  beginStackReorder,
  ContainerBar,
  LayoutIsolation,
  LayoutRenderer,
  type LayoutDecoration,
  type LayoutDecorationContext,
  readStackRows,
  startEntryDrag,
  type StackContainer,
  type ChromeContext,
  type ChromeItemFacts,
  type ChromeRegistry,
  type ChromeSlotFace,
  type LayoutIntents,
  createLayoutIntents,
  entrySashState,
  edgeRegion,
  isPresent,
  frontItem,
  resolveSizes,
  selectChild,
  reorderTab,
  visibleItems,
  resetStackBoundary,
  drawsRegionBar,
  useLayout,
} from "prac-ui-kit-content";
import {
  type Box,
  type Dir,
  type LayoutNode,
  type RegionNode,
  mergeGridCells,
  moveGridCell,
  findNode,
  findRegion,
} from "prac-ui-kit-layout";
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
 * @module prac-client-ui-frame/client/frame
 */

import {
  createElement,
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { UsePanelInfo } from "@deepseek-ai/dsh-client-ui-layout/client";

import { LayoutItem, type BoardDropFace, type ItemRenderSlot } from "./layout-item.js";

import { createFrameChrome } from "./frame-chrome.js";

import type { UseSessions } from "@deepseek-ai/dsh-client-ui-session/client";
import type { ApplicationSlotRenderer } from "prac-ui-kit-workbench";
import {
  declaredViewActionsFor,
  declaredViewIcon,
  declaredViewLabel,
  declaredViewPaneHeader,
} from "./catalogue.js";

import type { PracWindowActionsFace, WindowAction } from "./contract.js";

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
  "sidebar" | "main" | "rightbar" | "shell.overlay" | "prac.window" | "prac.widget"
>["renderSlot"];

// ── the frame ─────────────────────────────────────────────────────────

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

/** The unsaved marker inside a tab. */
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
[data-prac-widget-drop-active] { outline: 2px solid rgba(90, 160, 255, 0.9); outline-offset: -2px; }
[data-prac-widget-drop-active][data-prac-widget-drop-side="left"], [data-prac-widget-drop-active][data-prac-widget-drop-side="right"] { outline-color: rgba(90, 160, 255, 0.95); }
[data-prac-widget-drop-active][data-prac-widget-drop-side="top"], [data-prac-widget-drop-active][data-prac-widget-drop-side="bottom"] { outline-color: rgba(255, 170, 70, 0.95); }
:host([data-prac-view-chrome="frame"]) .pane-header .twisty-container,
:host([data-prac-view-chrome="frame"]) .pane-header .icon,
:host([data-prac-view-chrome="frame"]) .pane-header .title { display: none; }
:host([data-prac-view-chrome="frame"]) .pane-header { pointer-events: none; }
/* VS Code reveals a view's title actions while the pointer is anywhere in the
   view (title bar or body), not permanently. The row is the host's ancestor, so
   :host-context is what carries that hover across the isolation boundary. */
:host-context([data-prac-stack-entry]:hover) .pane-header .actions {
  display: flex !important;
  opacity: 1 !important;
  visibility: visible !important;
  align-items: center;
  height: 100%;
}
:host-context([data-prac-stack-entry]:hover) .pane-header .actions .action-label {
  opacity: 1 !important;
  visibility: visible !important;
}
:host([data-prac-view-chrome="frame"]) .pane-header .actions,
:host([data-prac-view-chrome="frame"]) .pane-header .actions * { pointer-events: auto; }
`;

/** Inject the frame's stylesheet once. */
export function ensureStyles(): void {
  if (document.getElementById("prac-client-ui-frame-styles")) return;
  const style = document.createElement("style");
  style.id = "prac-client-ui-frame-styles";
  style.textContent = FRAME_STYLES;
  document.head.append(style);
}

/**
 * A stack row's bottom `SASH_SIZE` px is its boundary: start a row resize.
 *
 * The row is a region (`data-prac-region`), but its boundary semantics are the
 * stack's own (B/C/D), so the drag goes through the entry controller rather than
 * the generic split resize.
 *
 * @param store - the layout store.
 * @param node - the stack row.
 * @param event - the pointer press on the row.
 */
function startEntryBoundaryDrag(
  store: LayoutStore,
  node: RegionNode,
  event: ReactPointerEvent<HTMLDivElement>,
): void {
  if (event.button !== 0) return;
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  if (event.clientY < rect.bottom - SASH_SIZE) return;
  const container = element.parentElement;
  if (container === null) return;
  // The **last** row has no boundary (B7), and a `Disabled` one must not start a
  // drag at all — no resize, no fallback. Only `Enabled`/`AtMinimum`/`AtMaximum`
  // reach the starter.
  const rows = readStackRows(container as unknown as StackContainer);
  const at = rows.findIndex((row) => row.itemId === node.id);
  if (at < 0 || at >= rows.length - 1) return;
  const state = entrySashState(
    store.get(),
    node.id,
    new Map(rows.map((row) => [row.itemId, row.height])),
  );
  if (state === "disabled") return;
  startEntryDrag<ItemRecord>(
    store,
    container as unknown as StackContainer,
    node.id,
    event.pointerId,
    event.clientY,
    element,
  );
  event.preventDefault();
}

/**
 * Double-clicking a stack row's bottom boundary resets the pair, the way a
 * double-click on a sash does (design B5).
 *
 * @param store - the layout store.
 * @param node - the stack row.
 * @param event - the double click.
 */
function resetEntryBoundary(
  store: LayoutStore,
  node: RegionNode,
  event: ReactMouseEvent<HTMLDivElement>,
): void {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  if (event.clientY < rect.bottom - SASH_SIZE) return;
  const container = element.parentElement;
  if (container === null) return;
  const reset = resetStackBoundary(readStackRows(container as unknown as StackContainer), node.id);
  store.update((next) => {
    let out = next;
    for (const { itemId, height } of reset) out = setEntryHeight(out, itemId, height);
    return out;
  });
}

/** The visible order of the items placed in one region. */
function orderOf(state: LayoutState, regionId: string): readonly string[] {
  return Object.entries(state.items)
    .filter(([, item]) => item.region === regionId)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id);
}

/** Accept a tab / view / grid-cell drag over a grid cell while cells can move. */
function gridCellDragOver(canDrag: boolean, event: ReactDragEvent<HTMLDivElement>): void {
  if (canDrag) event.preventDefault();
}

/**
 * Drop something onto one grid cell.
 *
 * Tabs and items land in the cell's region (or its leading edge when the cell is
 * a split); a grid cell dragged from another cell swaps placements, and
 * Shift-drag merges the two.
 *
 * @param store - the layout store.
 * @param gridId - the grid that owns the cell.
 * @param childId - the cell's child id.
 * @param canDrag - whether more than one cell is present.
 * @param event - the drop.
 */
function dropOnGridCell(
  store: LayoutStore,
  windows: WindowManager | undefined,
  gridId: string,
  childId: string,
  canDrag: boolean,
  event: ReactDragEvent<HTMLDivElement>,
): void {
  const state = store.get();
  const grid = findNode(state.tree, gridId);
  if (grid === null || grid.type !== "grid") return;
  const child = grid.children.find((candidate) => candidate.id === childId);
  if (child === undefined) return;
  const landing = (): RegionNode | null =>
    child.type === "region" ? child : edgeRegion(state, child, "left");
  const tab = event.dataTransfer?.getData("text/plain");
  if (tab !== undefined && tab !== "") {
    const target = landing();
    if (target !== null) {
      event.preventDefault();
      store.update((current) => place(current, tab, target.id));
      windows?.place(tab, target.id);
    }
    return;
  }
  const view = event.dataTransfer?.getData("text/prac-view");
  if (view !== undefined && view !== "") {
    const target = landing();
    if (target !== null) {
      event.preventDefault();
      store.update((current) => place(current, view, target.id));
      windows?.place(view, target.id);
    }
    return;
  }
  if (!canDrag) return;
  const source = event.dataTransfer?.getData("text/prac-grid-cell");
  if (source === undefined || source === "") return;
  event.preventDefault();
  store.update((current) => {
    const tree = event.shiftKey
      ? mergeGridCells(current.tree, gridId, source, childId)
      : moveGridCell(current.tree, gridId, source, childId);
    return tree === current.tree ? current : { ...current, tree };
  });
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

/** One text action in the tab strip; the model supplies the label and the run. */
const TAB_ACTION_STYLE: StyleObject = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  height: "100%",
  maxWidth: "140px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "0 5px",
  border: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

/** The actions a window offers, rendered at the tab strip's right end. */
function TabActions({
  face,
  viewId,
}: {
  face: PracWindowActionsFace;
  viewId: string;
}): ReactElement | null {
  const entry = useSyncExternalStore(
    (listener) => face.subscribe(listener),
    () => face.get(viewId),
  );
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) === true) return;
      if (toggleRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (entry === undefined) return null;
  const run = (action: WindowAction, event: MouseEvent): void => {
    event.stopPropagation();
    entry.run(action.id);
    setOpen(false);
  };
  const button = (action: WindowAction, showLabel: boolean): ReactElement =>
    createElement(
      "button",
      {
        key: action.id,
        type: "button",
        "data-prac-window-action": action.id,
        title: action.tooltip ?? action.label,
        "aria-label": action.label,
        "aria-pressed": action.checked ? "true" : undefined,
        disabled: action.enabled === false,
        onClick: (event: MouseEvent) => run(action, event),
        style: {
          ...TAB_ACTION_STYLE,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: showLabel ? "flex-start" : "center",
          gap: "4px",
          maxWidth: showLabel ? "none" : "140px",
          width: showLabel ? "100%" : undefined,
          height: showLabel ? "auto" : "100%",
          padding: showLabel ? "4px 8px" : undefined,
          textAlign: "left",
          color: showLabel ? "#eee" : "inherit",
          opacity: action.enabled === false ? 0.4 : 1,
        },
      },
      action.icon === undefined
        ? null
        : createElement("span", {
            className: action.icon,
            "aria-hidden": "true",
            style: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "16px",
              height: "100%",
              fontSize: "14px",
              flex: "0 0 auto",
            },
          }),
      action.icon === undefined || showLabel
        ? createElement(
            "span",
            { style: { overflow: "hidden", textOverflow: "ellipsis" } },
            action.checked ? "\u2713 " : "",
            action.label === "" ? action.id : action.label,
          )
        : null,
    );
  const visible = (actions: readonly WindowAction[]): readonly WindowAction[] =>
    actions.filter((action) => action.id !== "vs.actions.separator");
  const list = (actions: readonly WindowAction[]): ReactElement[] =>
    visible(actions).flatMap((action) =>
      action.submenu === undefined
        ? [button(action, true)]
        : [
            createElement(
              "span",
              { key: action.id, style: { padding: "2px 6px", opacity: 0.7 } },
              action.label,
            ),
            ...visible(action.submenu).map((child) => button(child, true)),
          ],
    );
  /**
   * The overflow menu lives in the document, not the tab strip: the strip and
   * the region both clip (`overflow: hidden` / `contain: paint`), so an
   * absolutely positioned menu was cut off at the first row.
   */
  const overflow =
    open && visible(entry.model.secondary).length > 0
      ? createPortal(
          createElement(
            "div",
            {
              ref: menuRef,
              role: "menu",
              "data-prac-window-actions-menu": viewId,
              style: {
                position: "fixed",
                top: `${menu.top}px`,
                right: `${menu.right}px`,
                zIndex: 10000,
                display: "flex",
                flexDirection: "column",
                minWidth: "180px",
                padding: "4px",
                background: "rgba(40,40,40,0.98)",
                border: "1px solid rgba(127,127,127,0.35)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
              },
            },
            ...list(entry.model.secondary),
          ),
          document.body,
        )
      : null;
  return createElement(
    "div",
    {
      "data-prac-window-actions": viewId,
      style: { display: "flex", alignItems: "center", flex: "0 0 auto", height: "100%" },
    },
    ...visible(entry.model.primary).map((action) => button(action, false)),
    visible(entry.model.secondary).length === 0
      ? null
      : createElement(
          "button",
          {
            ref: toggleRef,
            type: "button",
            "aria-label": "More actions",
            "aria-haspopup": "menu",
            "aria-expanded": open ? "true" : "false",
            title: "More actions",
            "data-prac-window-actions-more": viewId,
            onClick: (event: MouseEvent) => {
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ top: rect.bottom, right: Math.max(8, window.innerWidth - rect.right) });
              setOpen((value) => !value);
            },
            style: {
              ...TAB_ACTION_STYLE,
              display: "inline-flex",
              alignItems: "center",
            },
          },
          createElement("span", {
            className: "codicon codicon-ellipsis",
            "aria-hidden": "true",
            style: { fontSize: "14px" },
          }),
        ),
    overflow,
  );
}

/** Props DSH hands the root slot component. */
interface FrameProps {
  renderSlot: RenderSlot;
  useSessions: UseSessions;
  usePanelInfo: UsePanelInfo;
}

/** One DSH host window's body: render its host slot in the frame's tree. */
function DshHostWindowBody({
  renderSlot,
  viewId,
}: {
  renderSlot: RenderSlot;
  viewId: string;
}): ReactNode {
  if (viewId.startsWith("dsh:main:")) {
    return renderSlot("main", {}, { entryKey: viewId.slice("dsh:main:".length) });
  }
  return renderSlot(viewId === "dsh:sidebar" ? "sidebar" : "rightbar", {});
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
  sources: {
    readonly currentSession: CurrentSessionSource;
    readonly windows?: WindowManager;
    readonly contentHosts?: import("prac-ui-kit-workbench").ContentHostRegistry;
    readonly boardLayouts?: import("prac-ui-kit-workbench").BoardLayoutRegistry;
    readonly chrome?: ChromeRegistry<ItemRecord>;
    readonly windowActions: PracWindowActionsFace;
    /** The widget registry a board's drop target reports to (when its plugin is loaded). */
    readonly widgets?: () => BoardDropFace | undefined;
  },
): (props: FrameProps) => ReactElement {
  return function PracFrame({ renderSlot, useSessions, usePanelInfo }: FrameProps): ReactElement {
    const state = useLayout(store);
    const frameRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
      const element = frameRef.current;
      if (!element) return undefined;
      let raf: number | null = null;
      const measure = (): void => {
        // The **content** box: the root split is laid out inside the frame's padding, so measuring
        // the border box left the allocation larger than the box the regions are drawn in. A shell
        // that pads the frame (prac offsets the content under its fixed title bar) then saw every
        // stack fall short by the padding — the rows were right, the extent they shared was not.
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const width = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const height = box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        if (width <= 0 || height <= 0) return;
        store.update((current) =>
          current.viewportWidth === width && current.viewportHeight === height
            ? current
            : { ...current, viewportWidth: width, viewportHeight: height },
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

    const sizes = resolveSizes(
      state,
      state.viewportWidth,
      state.viewportHeight,
      sources.chrome === undefined
        ? undefined
        : (nodeId) => {
            const node = findNode(state.tree, nodeId);
            if (node === null) return undefined;
            const ctx = { state, node, regionId: nodeId };
            const total = { inlineStart: 0, inlineEnd: 0, blockStart: 0, blockEnd: 0 };
            for (const anchor of [
              "region.frame",
              "region.tabs",
              "region.header",
              "region.footer",
            ] as const) {
              const metrics = sources.chrome!.metrics(anchor, ctx);
              total.inlineStart += metrics.inlineStart;
              total.inlineEnd += metrics.inlineEnd;
              total.blockStart += metrics.blockStart;
              total.blockEnd += metrics.blockEnd;
            }
            return total;
          },
    );
    // The `SashState` tests are about what the rows are **drawn** at: a flexible row claims 0 in the
    // tree, so the claim alone cannot answer B2. `sizes` is this render's allocation.
    const rowHeights = new Map<string, number>([...sizes].map(([id, box]) => [id, box.height]));

    /**
     * A region renders the front-most visible view from the items table.
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
     * changes — and this path never folds anything (`setItemCollapsed` is not involved).
     */
    const beginReorder = (
      down: PointerDragEvent,
      viewId: string,
      containerIn?: HTMLElement | null,
    ): void => beginStackReorder<ItemRecord>(store, down, viewId, containerIn);

    /**
     * One region's tab strip: the visible items in order, the front one active.
     *
     * Borrowed from VS Code's editor group, including its `showTabs` default:
     * with `"multiple"` the strip is there for a single view too. Clicking a tab
     * brings that view to the front — the same ordering a `place` writes — so the
     * strip is a view of the region's order, not a second source of truth.
     *
     * @param items - the region's visible items, in order.
     */
    const tabStrip = (items: readonly string[], regionId: string): ReactElement => {
      const active = frontItem(state, regionId) ?? items[0];
      return createElement(TabStrip, {
        state,
        regionId,
        items,
        active,
        label: viewLabel,
        onActivate: (viewId: string) => {
          store.update((current) => setFront(current, viewId));
          sources.windows?.activate(viewId);
        },
        onClose: (viewId: string) => store.requestCloseItem(viewId),
        onReorder: (id: string, dragged: string, target: string) => {
          store.update((current) => {
            const next = reorderTab(current, id, dragged, target);
            if (next !== current) sources.windows?.reorder(id, orderOf(next, id));
            return next;
          });
        },
        renderActions: (viewId: string | undefined) =>
          createElement(
            Fragment,
            null,
            viewId === undefined ? null : declaredViewActionsFor(viewId)?.(),
            createElement(TabActions, { face: sources.windowActions, viewId: viewId ?? "" }),
          ),
      });
    };

    /**
     * One view's body, sized to the region's box.
     *
     * @param viewId - the view to render.
     * @param box - the box of the region holding it.
     */
    const viewBody = (viewId: string, box: Box, chrome?: "frame"): ReactElement => {
      // An app's content may render a host panel; the host offers its slot
      // renderer here, so the app decides its body without the frame hard-coding
      // a slot path for it.
      const windowContent = sources.windows?.windowContentFor(
        viewId,
        renderSlot as unknown as ApplicationSlotRenderer,
        { width: box.width, viewportWidth: state.viewportWidth },
      );
      // DSH host windows render in the frame's own tree, not behind the
      // isolation portal: the host slot renderer needs the frame's React
      // context. The body is a component, so its hooks stay per-window.
      if (viewId.startsWith("dsh:")) {
        return createElement(
          "div",
          {
            key: viewId,
            "data-prac-view-host": "",
            "data-prac-view-id": viewId,
            style: {
              display: "flex",
              flexDirection: "column",
              flex: "1 1 auto",
              minWidth: 0,
              minHeight: 0,
            },
          },
          createElement(DshHostWindowBody, { renderSlot, viewId }),
        );
      }
      return createElement(
        LayoutIsolation,
        { key: viewId, itemId: viewId, ...(chrome === undefined ? {} : { chrome }) },
        createElement(LayoutItem, {
          viewId,
          viewKind: state.items[viewId]?.kind ?? "window",
          contentHost:
            state.items[viewId]?.contentId === undefined
              ? undefined
              : sources.contentHosts?.get(state.items[viewId]!.contentId!),
          ...(state.items[viewId]?.contentRegion === undefined
            ? {}
            : {
                contentRegion: state.items[viewId]!.contentRegion!,
                renderContentRegion: (regionId: string) => {
                  const node = findNode(state.tree, regionId);
                  return node?.type === "region" ? renderRegion(node, "row") : null;
                },
              }),
          ...(state.items[viewId]?.boardId === undefined
            ? {}
            : {
                board: sources.boardLayouts?.get(state.items[viewId]!.boardId!),
              }),
          itemFacts,
          ...(sources.widgets === undefined ? {} : { widgets: sources.widgets }),
          renderSlot: renderSlot as unknown as ItemRenderSlot,
          ...(windowContent === undefined ? {} : { windowContent }),
          box,
          viewportWidth: state.viewportWidth,
        }),
      );
    };

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

    const containerBar = (node: RegionNode, activeId: string): ReactElement => {
      const selectedId = activeId.slice(activeId.lastIndexOf("/") + 1);
      const actionKey = selectedId.startsWith("container:")
        ? selectedId.slice("container:".length)
        : selectedId;
      const groups = new Map(
        (sources.windows?.barItems(node.id) ?? []).map((item): [string, GroupBarItem] => [
          item.regionId,
          item,
        ]),
      );
      const groupAt = (childId: string): GroupBarItem | undefined =>
        groups.get(childId) ??
        groups.get(`${node.id}/${childId}`) ??
        [...groups.values()].find((item) => item.regionId.endsWith(`/${childId}`));
      const childAt = (childId: string): LayoutNode | undefined =>
        (node.children ?? []).find((child) => child.id === childId);
      const active = groupAt(activeId);
      return createElement(ContainerBar, {
        containerId: node.id,
        label: node.label ?? `${node.id} containers`,
        items: (node.children ?? []).map((child) => ({
          id: child.id,
          label: groupAt(child.id)?.label ?? child.label ?? viewLabel(child.id),
          active: child.id === activeId,
          empty: !isPresent(state, child),
        })),
        actionKey,
        actions: active?.actions ?? [],
        onSelect: (childId: string) => {
          const child = childAt(childId);
          if (child === undefined) return;
          store.update((current) => {
            const tree = selectChild(current.tree, node.id, childId);
            return tree === current.tree ? current : { ...current, tree };
          });
        },
        onAction: (actionId: string) => active?.runAction?.(actionId),
      });
    };

    /**
     * A region renders the child it selects, or — when it holds items — its
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
      createElement(StackHeader, {
        nodeId: node.id,
        itemId: viewId,
        folded: node.collapsed === true,
        label: viewLabel(viewId),
        icon: viewIconNode(viewId),
        renderActions: createElement(
          Fragment,
          null,
          declaredViewActionsFor(viewId)?.(),
          createElement(TabActions, { face: sources.windowActions, viewId }),
        ),
        onToggle: (event) => {
          const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
          const height = row?.getBoundingClientRect().height;
          store.update((current) =>
            setEntryFolded(current, node.id, node.collapsed !== true, height),
          );
        },
        onReorder: (event) => {
          if (event.button !== 0) return;
          const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
          beginReorder(event as unknown as PointerDragEvent, node.id, row?.parentElement ?? null);
        },
      });

    /**
     * The frame's controls over a view that already brings its own pane header.
     *
     * The view owns the header, so the row keeps it (title + actions) and the frame
     * draws only the fold switch and the title drag area on top of it. The strip is
     * transparent and stops before the pane's action buttons, so the one title stays
     * the pane's. "Brings a pane header" is the view's declaration
     * (`paneHeader: true`), not a `vscode:` prefix.
     *
     * @param node - the stack row.
     * @param viewId - the view on the row.
     */
    const entryOverlay = (node: RegionNode, viewId: string): ReactElement =>
      createElement(StackRowOverlay, {
        nodeId: node.id,
        itemId: viewId,
        folded: node.collapsed === true,
        label: viewLabel(viewId),
        onToggle: (event) => {
          const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
          const height = row?.getBoundingClientRect().height;
          store.update((current) =>
            setEntryFolded(current, node.id, node.collapsed !== true, height),
          );
        },
        onReorder: (event) => {
          if (event.button !== 0) return;
          const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
          beginReorder(event as unknown as PointerDragEvent, node.id, row?.parentElement ?? null);
        },
      });

    /**
     * The frame's chrome, assembled for this render.
     *
     * Each contribution forwards to a control surface the frame already owns;
     * the renderer decides where the anchor sits. `sources.chrome` (another
     * container's contributions) is copied in first, so the frame adds to it
     * rather than replacing it.
     */
    const renderTabs = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const node = ctx.node;
      if (node.type !== "region") return null;
      const items = visibleItems(state, node.id);
      if (items.length === 0) return null;
      return tabStrip(items, node.id);
    };

    const renderContainerBar = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const node = ctx.node;
      if (node.type !== "region" || !drawsRegionBar(node)) return null;
      return containerBar(node, ctx.itemId ?? node.active ?? "");
    };

    const renderRowHeader = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const node = ctx.node;
      if (node.type !== "region" || node.entry !== true) return null;
      const viewId = ctx.itemId ?? visibleItems(state, node.id)[0];
      return viewId === undefined ? null : entryHeader(node, viewId);
    };

    const renderRowOverlay = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const node = ctx.node;
      if (node.type !== "region" || node.entry !== true || node.collapsed === true) return null;
      const items = visibleItems(state, node.id);
      if (items.length !== 1) return null;
      const viewId = items[0]!;
      return declaredViewPaneHeader(viewId) ? entryOverlay(node, viewId) : null;
    };

    const renderSash = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const node = ctx.node;
      if (node.type !== "split" || ctx.beforeId === undefined || ctx.afterId === undefined)
        return null;
      const before = findRegion(state.tree, ctx.beforeId);
      const after = findRegion(state.tree, ctx.afterId);
      if (before === null || after === null) return null;
      return createElement(LayoutSashDrag, {
        store,
        splitId: node.id,
        dir: node.dir,
        index: ctx.index ?? 1,
        leftId: before.id,
        rightId: after.id,
        offset: ctx.offset ?? 0,
        ...(before.entry === true && after.entry === true
          ? { stackState: entrySashState(state, before.id, rowHeights) }
          : {}),
      });
    };

    const renderGridCell = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const grid = ctx.node;
      const child = ctx.child;
      const placement = ctx.placement;
      const shape = ctx.shape;
      if (
        grid.type !== "grid" ||
        child === undefined ||
        placement === undefined ||
        shape === undefined
      )
        return null;
      return createElement(GridCellHandles, {
        store,
        grid,
        child,
        placement,
        shape,
        cellCount: ctx.cellCount ?? 0,
      });
    };

    const renderGridTrack = (ctx: ChromeContext<ItemRecord>): ReactNode => {
      const grid = ctx.node;
      if (
        grid.type !== "grid" ||
        ctx.track === undefined ||
        ctx.index === undefined ||
        ctx.shape === undefined
      )
        return null;
      return createElement(GridTrackHandle, {
        store,
        grid,
        axis: ctx.track,
        index: ctx.index,
        shape: ctx.shape,
      });
    };

    const chrome = createFrameChrome(
      {
        renderTabs,
        renderContainerBar,
        renderRowHeader,
        renderRowOverlay,
        renderSash,
        renderGridCell,
        renderGridTrack,
      },
      sources.chrome,
    );
    const intents: LayoutIntents = createLayoutIntents<ItemRecord>(store);

    /**
     * The frame's node decoration: surfaces, stack-row gestures, grid drops.
     *
     * Geometry stays in the renderer; these are the container's own facts (which
     * DOM element hosts a surface, where a press starts a row resize, what a drop
     * on a cell means).
     */
    const decorateNode = (
      ctx: LayoutDecorationContext<ItemRecord>,
    ): LayoutDecoration | undefined => {
      const node = ctx.node;
      const surface = sources.windows?.contentFor(node.id);
      const surfacePart: LayoutDecoration =
        surface === undefined
          ? {}
          : {
              attrs: { "data-prac-region-content": surface.kind },
            };
      if (ctx.kind === "region") {
        // A selector region renders a child that owns the surface: attaching the
        // child's surface to the selector too made two nodes claim one element
        // (the old renderer attached it on the child only).
        const selector = node.type === "region" && (node.children?.length ?? 0) > 0;
        return {
          ...(selector ? {} : surfacePart),
          ...(node.type === "region" && node.entry === true
            ? {
                onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) =>
                  startEntryBoundaryDrag(store, node, event),
                onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) =>
                  resetEntryBoundary(store, node, event),
              }
            : {}),
        };
      }
      if (ctx.kind === "split") return surfacePart;
      if (ctx.kind === "grid") return undefined;
      if (ctx.kind === "cell") {
        const canDrag = (ctx.cellCount ?? 0) > 1;
        return {
          onDragOver: (event: ReactDragEvent<HTMLDivElement>) => gridCellDragOver(canDrag, event),
          onDrop: (event: ReactDragEvent<HTMLDivElement>) =>
            dropOnGridCell(store, sources.windows, node.id, ctx.itemId ?? "", canDrag, event),
        };
      }
      return undefined;
    };

    /**
     * Render one layout subtree through the generic renderer.
     *
     * The frame no longer draws region DOM itself: it assembles the renderer's
     * inputs (allocation, item renderer, chrome, intents, decorations) and the
     * renderer owns the geometry. `renderRegion` remains the frame's name for
     * "render a subtree rooted here" — the window-content path calls it for a
     * region inside a window, and the root call is the same function.
     *
     * @param node - the subtree root.
     * @param dir - the parent split's axis.
     * @param fill - whether the root fills a selector's box.
     */
    const itemFacts = (viewId: string): ChromeItemFacts => {
      const label = declaredViewLabel(viewId) ?? sources.windows?.titleOf(viewId);
      const icon = declaredViewIcon(viewId);
      return {
        ...(label === undefined ? {} : { label }),
        ...(icon === undefined ? {} : { icon }),
        paneHeader: declaredViewPaneHeader(viewId),
      };
    };

    const renderRegion = (node: LayoutNode, dir: Dir, fill = false): ReactElement =>
      LayoutRenderer({
        state,
        root: node,
        dir,
        fill,
        sizes,
        chrome,
        intents,
        slotFace: renderSlot as unknown as ChromeSlotFace,
        itemFacts,
        renderItem: (_record, viewId, box, options) => viewBody(viewId, box, options?.chrome),
        ownHeader: (_record, viewId) => declaredViewPaneHeader(viewId),
        renderEmpty: (ctx) => (ctx.itemId === undefined ? null : emptyPane(ctx.itemId)),
        decorate: decorateNode,
      });

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
      renderRegion(state.tree, "row"),
      // The overlay layer: above every region, click-through until an
      // entry opts into pointer events (see FRAME_STYLES).
      createElement(
        "div",
        {
          "data-prac-overlay-layer": "",
          style: { position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" },
        },
        // The float layer is the frame's overlay: its entries are surfaces
        // themselves (the workbench float host, prac overlays) and must be direct
        // children here. Wrapping them in an isolation root clipped the workbench's
        // context items/quick input inside that shadow instead of the overlay.
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
