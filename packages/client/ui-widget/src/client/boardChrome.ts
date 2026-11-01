/**
 * A board's container chrome.
 *
 * The board side of `createContainerChrome`: windows in a board get the same
 * control surfaces as windows in the frame — a tab strip, stack-row headers, an
 * item's actions, sashes between regions, and the grid handles — but every
 * behaviour writes the **board's** state and renders the widget's own actions.
 * The parts themselves are the frame's generic components (`TabStrip`,
 * `StackHeader`, `LayoutSashDrag`, `GridCellHandles`, …), so this is a container,
 * not a second renderer.
 *
 * @module prac-client-ui-widget/client/boardChrome
 */
import { createElement } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  GridCellHandles,
  GridTrackHandle,
  LayoutSashDrag,
  StackHeader,
  StackRowOverlay,
  TabStrip,
  ViewActions,
  beginStackReorder,
  createContainerChrome,
  createLayoutIntents,
  entrySashState,
  findRegion,
  frontView,
  reorderTab,
  setEntryFolded,
  visibleViews,
  type ChromeContext,
  type ChromeRegistry,
  type LayoutIntents,
  type LayoutStore,
  type ViewActionsProps,
  type WidgetRecord,
} from "prac-client-ui-frame/lib";
import type { BoardContent } from "./boardContent.js";
import { startWidgetDrag } from "./widgetDrag.js";
import { createBoardStore } from "./boardStore.js";

/** The id tail, as a fallback display label. */
const label = (id: string): string => (id.split(":").pop() ?? id).replace(/[-_]/g, " ");

/** How a board chrome is built. */
export interface BoardChromeOptions {
  /** A store over the board; defaults to {@link createBoardStore}. */
  readonly store?: LayoutStore;
  /** Chrome mutations; defaults to the shared intents over `store`. */
  readonly intents?: LayoutIntents;
}

/**
 * Build the board's chrome registry.
 *
 * @param content - the board whose layout the chrome controls.
 * @param options - an existing store / intents (tests, or a board that already
 *   publishes them).
 */
export function createBoardChrome(
  content: BoardContent,
  options: BoardChromeOptions = {},
): ChromeRegistry<WidgetRecord> {
  const store = options.store ?? createBoardStore(content);
  const intents = options.intents ?? createLayoutIntents(store);

  /** The title the container declared for a widget, else the id tail. */
  const labelFor = (ctx: ChromeContext<WidgetRecord>, viewId: string): string =>
    ctx.itemFacts?.(viewId).label ?? label(viewId);

  /** Whether the widget brings its own pane header (the row overlays it). */
  const hasPaneHeader = (ctx: ChromeContext<WidgetRecord>, viewId: string): boolean =>
    ctx.itemFacts?.(viewId).paneHeader === true;

  /** The widget's own actions, dispatched through the container's slot face. */
  const renderActions = (ctx: ChromeContext<WidgetRecord>, viewId: string): ReactNode => {
    if (ctx.slotFace === undefined) return null;
    return createElement(ViewActions, {
      viewId,
      kind: "widget",
      renderSlot: ctx.slotFace as unknown as ViewActionsProps["renderSlot"],
    });
  };

  const renderTabs = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
    if (ctx.node.type !== "region") return null;
    const views = visibleViews(ctx.state, ctx.node.id);
    if (views.length === 0) return null;
    const active = frontView(ctx.state, ctx.node.id) ?? views[0];
    return createElement(TabStrip, {
      state: ctx.state,
      regionId: ctx.node.id,
      views,
      active,
      label: (id) => labelFor(ctx, id),
      onActivate: (id) => intents.activate(id),
      onClose: (id) => intents.close(id),
      onReorder: (regionId, dragged, target) =>
        store.update((state) => reorderTab(state, regionId, dragged, target)),
      renderActions: (viewId) => (viewId === undefined ? null : renderActions(ctx, viewId)),
      onItemDragStart: (event, widgetId) =>
        startWidgetDrag(event, { boardId: content.id, widgetId }),
    });
  };

  const renderRowHeader = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
    const node = ctx.node;
    if (node.type !== "region" || node.entry !== true) return null;
    const viewId = ctx.itemId ?? visibleViews(ctx.state, node.id)[0];
    if (viewId === undefined) return null;
    const icon = ctx.itemFacts?.(viewId).icon;
    const folded = node.collapsed === true;
    const toggle = (event: ReactMouseEvent<HTMLElement>): void => {
      const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
      const height = row?.getBoundingClientRect().height;
      if (height === undefined) {
        intents.fold(node.id, !folded);
        return;
      }
      store.update((state) => setEntryFolded(state, node.id, !folded, height));
    };
    return createElement(StackHeader, {
      nodeId: node.id,
      viewId,
      folded,
      label: labelFor(ctx, viewId),
      ...(icon === undefined
        ? {}
        : { icon: createElement("span", { className: icon, "aria-hidden": "true" }) }),
      onToggle: toggle,
      onReorder: (event) => {
        if (event.button !== 0) return;
        const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
        beginStackReorder(store, event, node.id, row?.parentElement ?? null);
      },
      renderActions: renderActions(ctx, viewId),
      onDragStart: (event) => startWidgetDrag(event, { boardId: content.id, widgetId: viewId }),
    });
  };

  const renderRowOverlay = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
    const node = ctx.node;
    if (node.type !== "region" || node.entry !== true || node.collapsed === true) return null;
    const views = visibleViews(ctx.state, node.id);
    if (views.length !== 1) return null;
    const viewId = views[0]!;
    if (!hasPaneHeader(ctx, viewId)) return null;
    return createElement(StackRowOverlay, {
      nodeId: node.id,
      viewId,
      folded: false,
      label: labelFor(ctx, viewId),
      onToggle: (event: ReactMouseEvent<HTMLElement>) => {
        const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
        const height = row?.getBoundingClientRect().height;
        if (height === undefined) {
          intents.fold(node.id, true);
          return;
        }
        store.update((state) => setEntryFolded(state, node.id, true, height));
      },
      onReorder: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const row = (event.currentTarget as HTMLElement).closest("[data-prac-region]");
        beginStackReorder(store, event, node.id, row?.parentElement ?? null);
      },
    });
  };

  const renderSash = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
    const node = ctx.node;
    if (node.type !== "split" || ctx.beforeId === undefined || ctx.afterId === undefined)
      return null;
    const before = findRegion(ctx.state.tree, ctx.beforeId);
    const after = findRegion(ctx.state.tree, ctx.afterId);
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
        ? { stackState: entrySashState(ctx.state, before.id) }
        : {}),
    });
  };

  const renderGridCell = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
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

  const renderGridTrack = (ctx: ChromeContext<WidgetRecord>): ReactNode => {
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

  return createContainerChrome<WidgetRecord>({
    renderTabs,
    renderContainerBar: () => null,
    renderRowHeader,
    renderRowOverlay,
    renderSash,
    renderGridCell,
    renderGridTrack,
  });
}
