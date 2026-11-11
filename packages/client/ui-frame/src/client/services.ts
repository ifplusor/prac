import {
  RegionContentRegistry,
  type GroupRegionContent,
  CENTER_REGION,
  type LayoutState,
  type ItemRecord,
  ensureItem,
  place,
  placeQuietly,
  pruneEmbedderRegions,
  removeRegion as removeRegionFromTree,
  removeItem,
  setCollapsed,
  setItemCollapsed,
  setItemSize,
  setFront,
  splitRegionWith,
  type LayoutStore,
  ContentHostRegistry,
  BoardLayoutRegistry,
  ApplicationRegistry,
  WindowGroupBindings,
  type RegionBinding,
  type WindowGroup,
} from "prac-ui-kit-workbench";
import {
  type ChromeRegistry,
  type ItemFlags,
  type RegionInfo,
  activeChild,
  regionInDirection as findRegionInDirection,
  frontItem,
  regionInfos,
  ensureStackShape,
  regionNode,
  setRegionChildren,
  setRegionSelector as setSelectorInTree,
  setRegionSize,
  selectChild,
  structuralRegion,
} from "prac-ui-kit-content";
import {
  type RegionChild,
  type RegionSelector,
  type Side,
  findRegion,
  findNode,
  freshNodeId,
  firstRegionId,
  mergeGridCells,
  moveGridCell,
  unmergeGridCell,
  resizeGridCell,
  resizeGridTrack,
  setGridTrackWeight,
} from "prac-ui-kit-layout";
/**
 * The faces this mechanism publishes, plus the root hook the frame's children
 * read.
 *
 * Three consumers, three shapes:
 *
 * - `layout` — DSH's own layout face, a **compat shim**: its positional
 *   vocabulary (`sidebar`, `rightbar`, one central panel) is what
 *   `ui-workspace`, `ui-sidebar` and `ui-sidebar-right` call. Every method is a
 *   pure translation into prac's region model, never into a fixed column. It can
 *   be deleted when prac stops reusing those plugins.
 * - `pracFrame` — prac's placement face, what the arrangement (and the recall
 *   surface) drives: the view catalogue, placement, collapse, splits, widths.
 * - `panelInfo` — the root hook (`usePanelInfo`) projecting the active main
 *   panel, which the document title and any panel-aware component read.
 *
 * The faces close over the store and the slot registry; nothing here registers
 * anything, so the assembly (`index.ts`) stays the only place that owns
 * lifecycle.
 *
 * @module prac-client-ui-frame/client/services
 */

import type { Context } from "@deepseek-ai/cordis";
import type { MainPanelId, PanelInfo } from "@deepseek-ai/dsh-client-ui-layout/client";
import type { HostObservable } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { catalogueViewIds, declaredViewSlot } from "./catalogue.js";

import type { LayoutFace, PracLayoutFace, RoleBindings } from "./contract.js";

import type { ItemInfo } from "./contract.js";
import { listCatalogueItems } from "./catalogue-items.js";
import { WindowManager, type WindowGroupRuntime } from "./window-manager.js";

/** Whether a view's region sits inside the subtree a region id names. */
function inRegionSubtree(region: string, target: string): boolean {
  return region === target || region.startsWith(`${target}/`);
}

/** What {@link createServices} builds for the assembly to publish. */
export interface LayoutServices {
  /** DSH's layout face (the compat shim). */
  readonly layout: LayoutFace;
  /** prac's placement face. */
  readonly pracFrame: PracLayoutFace;
  /** The `panelInfo` root hook's observable. */
  readonly panelInfo: HostObservable<PanelInfo>;
  /** The frame's view-group owner. */
  readonly windows: WindowManager;
  /** The app definitions partners contribute. */
  readonly applications: ApplicationRegistry;
  /** Region-content factories registered by window / widget plugins. */
  readonly surfaces: RegionContentRegistry<WindowGroup>;
  /** Runtime content hosts for windows; keyed by `contentId`. */
  readonly contentHosts: ContentHostRegistry;
  /** Board layout roots; keyed by `boardId`. */
  readonly boardLayouts: BoardLayoutRegistry;
}

/**
 * Build the faces over one store.
 *
 * @param ctx - the Cordis client context (the slot registry is read for `main`).
 * @param store - the layout store the faces read and update.
 * @returns the two faces and the panel hook.
 */
export function createServices(
  ctx: Context,
  store: LayoutStore,
  closeListeners: Set<(viewId: string) => void>,
): LayoutServices {
  // The frame's own housekeeping at load: the regions the embedder created and left empty are
  // leftovers of a session whose files are gone, and nothing on screen can close them (see
  // `pruneEmbedderRegions`). Idempotent, and it runs before the app places anything.
  // Every write keeps the stack invariant: a region with two visible items **is** a column split of
  // one-view rows. Hiding the last visible view, placing one, folding one — they all change the shape
  // (a stack that falls back to one row melts, an empty leftover holds no space), so the normaliser
  // runs on the way out of each change rather than only on placements.
  /** The DSH host face, when a host is present (the frame does not require one). */
  let dshHost: { conversation: string; mainView(key: string): string } | undefined;
  ctx.inject(["pracDsh"], (scope) => {
    dshHost = (
      scope as unknown as {
        pracDsh: { conversation: string; mainView(key: string): string };
      }
    ).pracDsh;
    return () => {
      dshHost = undefined;
    };
  });

  const applications = new ApplicationRegistry();
  const windows = new WindowManager(new WindowGroupBindings(store), applications, {
    register: (windowId, facts, content) => {
      // `paneHeader` is this frame's own option, not one the registry's base
      // type knows; keep it out of the literal's excess-property check.
      const options = {
        name: "prac.window" as const,
        id: windowId,
        ...(facts.label === undefined ? {} : { label: facts.label }),
        ...(facts.paneHeader === true ? { paneHeader: true } : {}),
      };
      return ctx.slots.register(options, content);
    },
  });
  const surfaces = new RegionContentRegistry<WindowGroup>();
  const originalUpdate = store.update;
  const write = (change: Parameters<typeof store.update>[0]): void => originalUpdate(change);
  store.update = (change: Parameters<typeof store.update>[0]) =>
    write((state: LayoutState) => ensureStackShape(change(state)));
  store.update(pruneEmbedderRegions);

  /** The arrangement's role bindings (empty until it binds them). */
  const roles: RoleBindings = {};

  /** Where a view parks when it gives up the centre (unbound until the arrangement says). */
  let trackRegion: string | undefined;

  /** The region new centre items go to: the frame's centre, or the first region without one. */
  const centreRegion = (state: LayoutState): string =>
    findRegion(state.tree, CENTER_REGION) ? CENTER_REGION : firstRegionId(state.tree);

  /** Monotonic ids for regions and splits created after boot. */
  let nodeSeq = 0;
  /**
   * The next id for a new region or split.
   *
   * The counter restarts every page load while the tree does not, so an id is only usable
   * when the restored tree has not taken it (see `freshNodeId`).
   *
   * @param kind - the id's prefix.
   * @param state - the state the new node will join.
   */
  const nextNodeId = (kind: string, state: LayoutState): string =>
    freshNodeId(state.tree, kind, () => (nodeSeq += 1));

  /**
   * Whether the `main` slot currently has an entry under this key.
   *
   * @param id - the main panel key.
   */
  const hasMainPanel = (id: string): boolean =>
    ctx.slots.entries("main").some((entry) => entry.options.key === id);

  // The `panelInfo` shared source: part of the published face, and the root hook
  // (`usePanelInfo`) that any panel-aware component reads.
  //
  // The snapshot is cached: `useSyncExternalStore` compares by identity and
  // loops forever (or drops every update) if `getSnapshot` mints a fresh
  // object on each call.
  let panelSnapshot: PanelInfo = { activePanelId: null };
  const panelInfo: HostObservable<PanelInfo> = {
    getSnapshot: () => panelSnapshot,
    subscribe: (listener: () => void) =>
      store.subscribe(() => {
        const next = store.get().activePanelId;
        if (next === panelSnapshot.activePanelId) return;
        panelSnapshot = { activePanelId: next as MainPanelId | null };
        listener();
      }),
  };

  let navigation = new AbortController();
  const layout: LayoutFace = {
    panelInfo,
    selectPanel(panelId: string | null): void {
      if (panelId !== null && !hasMainPanel(panelId)) {
        throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
      }
      navigation.abort();
      navigation = new AbortController();
      store.update((state) => {
        // The host owns its panel ids (the DSH host provides the face); the
        // frame only places the window the host names. Captured through a
        // dynamic inject: a plain property read on a context that does not
        // declare the service throws in Cordis.
        if (dshHost === undefined) {
          throw new Error("layout.selectPanel: the DSH host face is not available");
        }
        const viewId = panelId === null ? dshHost.conversation : dshHost.mainView(panelId);
        // The chosen view goes where the *arrangement* placed it, or to the
        // centre when it has no home of its own — never to "wherever the panel
        // on show happened to sit". A view parked in the track counts as having
        // no home: selecting it brings it back to the centre.
        const current = state.items[viewId]?.region;
        const regionId =
          current !== undefined && current !== trackRegion ? current : centreRegion(state);
        const outgoing = frontItem(state, regionId);
        const next = place({ ...state, activePanelId: panelId }, viewId, regionId);
        // One view holds a region. The one that gave it up parks in the track
        // the arrangement bound, which is what lets a panel and the
        // conversation share the screen instead of replacing each other.
        if (
          trackRegion === undefined ||
          trackRegion === regionId ||
          outgoing === undefined ||
          outgoing === viewId
        ) {
          return next;
        }
        return place(next, outgoing, trackRegion);
      });
    },
    beginNavigation(): AbortSignal {
      navigation.abort();
      navigation = new AbortController();
      return navigation.signal;
    },
    toggleSidebar(): void {
      const viewId = roles.primarySidebar;
      if (viewId === undefined) return;
      store.update((state) => {
        const regionId = state.items[viewId]?.region;
        if (regionId === undefined) return state;
        const node = findRegion(state.tree, regionId);
        if (!node) return state;
        return setCollapsed(state, regionId, !node.collapsed);
      });
    },
    openRightbar(_track: boolean, _fullscreen: boolean): void {
      const viewId = roles.secondarySidebar;
      if (viewId === undefined) return;
      // The role's region hosts it; DSH's own right panel asks to be shown, so
      // it is unhidden and brought to the front of wherever it already sits.
      store.update((state) => {
        const view = ensureItem(state, viewId);
        const lowest = Math.min(0, ...Object.values(state.items).map((entry) => entry.order));
        return {
          ...state,
          items: { ...state.items, [viewId]: { ...view, hidden: false, order: lowest - 1 } },
        };
      });
    },
    closeRightbar(): void {
      const viewId = roles.secondarySidebar;
      if (viewId === undefined) return;
      store.update((state) => {
        const view = ensureItem(state, viewId);
        return { ...state, items: { ...state.items, [viewId]: { ...view, hidden: true } } };
      });
    },
  };

  const contentHosts = new ContentHostRegistry();
  const boardLayouts = new BoardLayoutRegistry();
  const pracFrame: PracLayoutFace = {
    getState: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    /** The union of the slot registry's items and each one's placement. */
    listItems(): ItemInfo[] {
      return listCatalogueItems(
        store.get(),
        catalogueViewIds(ctx.slots),
        windows.ids(),
        declaredViewSlot,
      );
    },
    /** The regions a view can be moved to (id + collapse state). */
    listRegions(): RegionInfo[] {
      return regionInfos(store.get().tree);
    },
    /** Move a view into a region and show it; the manager writes the group. */
    place(viewId: string, regionId: string): void {
      store.update((state) => place(state, viewId, regionId));
      windows.place(viewId, regionId);
    },
    /** Move a view into a region without changing which child that region shows. */
    placeQuietly(viewId: string, regionId: string): void {
      store.update((state) => placeQuietly(state, viewId, regionId));
    },
    /** Forget a view's placement record (see the face's own note). */
    removeItem(viewId: string): void {
      store.update((state) => removeItem(state, viewId));
    },
    /** Give a region its child regions — the container shape. */
    setRegionChildren(regionId: string, children: readonly RegionChild[], label?: string): void {
      store.update((state) => {
        // A container's children **stack** their items: that is what a container
        // is for — grouping items that share one strip of screen.
        const nodes = children.map((child) => {
          // **Keep** a subtree that already exists under this id: it may be a `column` split (a stack
          // that took the region's place), and rebuilding it as a fresh region would throw its rows
          // away. The caller read the children, other placements happened, then it wrote.
          const existing = findNode(state.tree, child.id);
          if (existing !== null) {
            // Keep the shape it already has (it may be a `column` split), but take the name the
            // caller knows: a container that became a stack must not show up as its raw id.
            return child.label === undefined || existing.label === child.label
              ? existing
              : { ...existing, label: child.label };
          }
          return regionNode(child.id, 0, {
            label: child.label,
            stack: true,
          });
        });
        const tree = setRegionChildren(state.tree, regionId, nodes, label);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** The child regions a region selects among. */
    regionChildren(regionId: string): RegionChild[] {
      const node = findRegion(store.get().tree, regionId);
      return (node?.children ?? []).map((child) => ({
        id: child.id,
        // A child that became a stack is a split carrying the region's name (see `SplitNode.label`).
        label: child.label,
      }));
    },
    /** Declare how a region presents its choice among its children (geometry follows the kind). */
    setRegionSelector(regionId: string, selector: RegionSelector): void {
      store.update((state) => {
        const tree = setSelectorInTree(state.tree, regionId, selector);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Bring one of a region's children to the front (a dock rail's click, without a hidden button). */
    selectContainer(regionId: string, childId: string): void {
      store.update((state) => {
        const tree = selectChild(state.tree, regionId, childId);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** The child a region currently shows (the rail's active item). */
    activeContainer(regionId: string): string | null {
      const state = store.get();
      const node = findRegion(state.tree, regionId);
      return node === null ? null : (activeChild(state, node)?.id ?? null);
    },
    setFront(viewId: string): void {
      store.update((state) => setFront(state, viewId));
    },
    /** Declare the height a view wants as a stack row (see the model's doc). */
    registerContentHost(
      contentId: string,
      host: import("prac-ui-kit-content").ContentHost,
    ): () => void {
      return contentHosts.register(contentId, host);
    },
    registerBoardLayout(
      boardId: string,
      source:
        | import("prac-ui-kit-workbench").BoardLayoutSource
        | import("prac-ui-kit-workbench").LayoutState<import("prac-ui-kit-workbench").WidgetRecord>,
      chrome?: ChromeRegistry<import("prac-ui-kit-workbench").WidgetRecord>,
    ): () => void {
      return boardLayouts.register(boardId, source, chrome);
    },
    setItemBoard(viewId: string, boardId: string | undefined): void {
      store.update((state) => {
        const view = ensureItem(state, viewId);
        const { boardId: _old, ...rest } = view;
        return {
          ...state,
          items: {
            ...state.items,
            [viewId]: boardId === undefined ? rest : { ...rest, boardId },
          },
        };
      });
    },
    setItemKind(viewId: string, kind: "window" | "widget"): void {
      store.update((state) => {
        const view = ensureItem(state, viewId);
        return { ...state, items: { ...state.items, [viewId]: { ...view, kind } } };
      });
    },
    setItemSize(viewId: string, size: number): void {
      store.update((state) => setItemSize(state, viewId, size));
    },
    /** Show/hide a view without moving it. */
    show(viewId: string): void {
      store.update((state) => {
        const view = ensureItem(state, viewId);
        return { ...state, items: { ...state.items, [viewId]: { ...view, hidden: false } } };
      });
    },
    hide(viewId: string): void {
      store.update((state) => {
        const view = ensureItem(state, viewId);
        return { ...state, items: { ...state.items, [viewId]: { ...view, hidden: true } } };
      });
    },
    registerWindowGroup(group: WindowGroup, regionId: string): RegionBinding {
      return windows.register(group as unknown as WindowGroupRuntime, regionId);
    },
    registerContent(content: GroupRegionContent<WindowGroup>, regionId: string): RegionBinding {
      return windows.registerContent(content, regionId);
    },
    unregisterWindowGroup(groupId: string): void {
      windows.unregister(groupId);
    },
    setItemCollapsed(viewId: string, collapsed: boolean): void {
      // Through the model: a view that lives in a stack **row** folds through its region, so writing
      // the record here would leave the picture unchanged. E1 wants the height it is drawn at, and
      // this face has the DOM the model deliberately does not: read the row before folding, so an
      // unfold comes back to the drawn height instead of the floor.
      const height =
        typeof document === "undefined"
          ? undefined
          : document
              .querySelector(`[data-prac-stack-entry="${CSS.escape(viewId)}"]`)
              ?.getBoundingClientRect().height;
      store.update((state) => setItemCollapsed(state, viewId, collapsed, height));
    },
    /** Collapse a region to nothing (remembering its size) or restore it. */
    setCollapsed(regionId: string, collapsed: boolean): void {
      store.update((state) => setCollapsed(state, regionId, collapsed));
    },
    /** Resize a fixed region. */
    setWidth(regionId: string, width: number): void {
      store.update((state) => {
        const tree = setRegionSize(state.tree, regionId, width);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /**
     * Split a view out into a new region beside the one holding it.
     *
     * Two writes in one update, because they are one gesture: the tree gains the
     * split, then the view is placed into the new region — through `place`, so
     * "the moved view is the front of its region and visible" has one rule, not
     * two spellings. A view that is placed nowhere has no region to split, and a
     * region that no longer exists is not a split target: both are no-ops.
     */
    splitItem(viewId: string, side: Side): void {
      store.update((state) => {
        const record: ItemRecord | undefined = state.items[viewId];
        if (record === undefined) return state;
        const splitId = nextNodeId("split", state);
        const newRegionId = nextNodeId("region", state);
        // Address the region the view's home **stands for**: if it lives in a stack row, splitting
        // the row would put the new pane inside the stack.
        const next = splitRegionWith(
          state,
          structuralRegion(state.tree, record.region),
          side,
          splitId,
          newRegionId,
          { gridCells: true },
        );
        if (next === state) return state;
        return place(next, viewId, newRegionId);
      });
    },
    /** Swap two cells in a grid. */
    moveGridCell(gridId: string, cellId: string, targetId: string): void {
      store.update((state) => {
        const tree = moveGridCell(state.tree, gridId, cellId, targetId);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Merge two adjacent grid cells into one split cell. */
    mergeGridCells(gridId: string, sourceId: string, targetId: string): void {
      store.update((state) => {
        const tree = mergeGridCells(state.tree, gridId, sourceId, targetId);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Split a merged grid cell back into its children. */
    unmergeGridCell(gridId: string, cellId: string): void {
      store.update((state) => {
        const tree = unmergeGridCell(state.tree, gridId, cellId);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Set one grid track's relative weight. */
    setGridTrackWeight(
      gridId: string,
      axis: "column" | "row",
      index: number,
      weight: number,
    ): void {
      store.update((state) => {
        const tree = setGridTrackWeight(state.tree, gridId, axis, index, weight);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Drag a track boundary by a pixel delta. */
    resizeGridTrack(
      gridId: string,
      axis: "column" | "row",
      boundary: number,
      delta: number,
      extent: number,
    ): void {
      store.update((state) => {
        const tree = resizeGridTrack(state.tree, gridId, axis, boundary, delta, extent);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** Resize one grid cell; overlapping spans are refused. */
    resizeGridCell(gridId: string, cellId: string, rowSpan: number, columnSpan: number): void {
      store.update((state) => {
        const tree = resizeGridCell(state.tree, gridId, cellId, rowSpan, columnSpan);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /**
     * Split a region in two without moving a view into it (see the face's doc).
     *
     * The tree edit is the same one `splitItem` makes; what differs is that no view is
     * placed, so the new region starts empty and becomes visible when the app puts a view
     * there (which is exactly what the workbench's move/open into the new group produces).
     */
    regionInDirection(regionId: string, side: Side): string | undefined {
      return findRegionInDirection(store.get().tree, regionId, side);
    },
    /**
     * Remove a region — the inverse of {@link createRegionBeside}.
     *
     * The embedder asks for this when a group it created is gone (its last editor closed and
     * the group is not the only one left). The region's **items go with it**: a record that
     * pointed at a region which no longer exists would render nowhere and stay "known" for
     * good.
     *
     * @param regionId - the region to remove.
     */
    removeRegion(regionId: string): void {
      store.update((state) => {
        const next = removeRegionFromTree(state, regionId);
        if (next === state) return state;
        const items = Object.fromEntries(
          Object.entries(state.items).filter(([, view]) => !inRegionSubtree(view.region, regionId)),
        );
        return { ...next, items };
      });
    },
    createRegionBeside(regionId: string, side: Side): string | undefined {
      let created: string | undefined;
      store.update((state) => {
        const splitId = nextNodeId("split", state);
        const newRegionId = nextNodeId("region", state);
        const next = splitRegionWith(state, regionId, side, splitId, newRegionId, {
          embedder: true,
          gridCells: true,
        });
        if (next === state) return state;
        created = newRegionId;
        return next;
      });
      return created;
    },
    /**
     * Merge chrome flags into a view's record.
     *
     * A no-op when nothing changes, by identity: a UI that re-syncs flags on every
     * layout change (the editor package does) must not wake the store in a loop.
     */
    onDidRequestCloseItem(listener: (viewId: string) => void): () => void {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    setItemFlags(viewId: string, flags: ItemFlags): void {
      store.update((state) => {
        const view = state.items[viewId];
        if (!view) return state;
        const next = { ...view.flags, ...flags };
        const same =
          (next.dirty ?? false) === (view.flags?.dirty ?? false) &&
          (next.preview ?? false) === (view.flags?.preview ?? false) &&
          (next.closable ?? false) === (view.flags?.closable ?? false);
        return same
          ? state
          : { ...state, items: { ...state.items, [viewId]: { ...view, flags: next } } };
      });
    },
    /** The centre region's front view: what prac is showing as active. */
    activeItem(): string | null {
      const state = store.get();
      return frontItem(state, centreRegion(state)) ?? null;
    },
    /** Bind the roles DSH's borrowed vocabulary resolves through. */
    bindRoles(next: RoleBindings): void {
      if (next.primarySidebar !== undefined) roles.primarySidebar = next.primarySidebar;
      if (next.secondarySidebar !== undefined) roles.secondarySidebar = next.secondarySidebar;
    },
    bindTrack(regionId: string): void {
      trackRegion = regionId;
    },
  };

  return {
    layout,
    pracFrame,
    panelInfo,
    windows,
    applications,
    surfaces,
    contentHosts,
    boardLayouts,
  };
}
