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
 * - `pracLayout` — prac's placement face, what the arrangement (and the recall
 *   surface) drives: the view catalogue, placement, collapse, splits, widths.
 * - `panelInfo` — the root hook (`usePanelInfo`) projecting the active main
 *   panel, which the document title and any panel-aware component read.
 *
 * The faces close over the store and the slot registry; nothing here registers
 * anything, so the assembly (`index.ts`) stays the only place that owns
 * lifecycle.
 *
 * @module prac-client-ui-layout/client/services
 */

import type { Context } from "@deepseek-ai/cordis";
import type { MainPanelId, PanelInfo } from "@deepseek-ai/dsh-client-ui-layout/client";
import type { HostObservable } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { DSH_CONVERSATION_KEY, DSH_MAIN_PREFIX, catalogueViewIds } from "./catalogue.js";
import {
  CENTER_REGION,
  type LayoutFace,
  type LayoutState,
  type PracLayoutFace,
  type RegionChild,
  type RoleBindings,
  type Side,
  type ViewFlags,
  type ViewRecord,
} from "./contract.js";
import type { RegionInfo, ViewInfo } from "./catalogue.js";
import {
  ensureView,
  findRegion,
  freshNodeId,
  regionInDirection as findRegionInDirection,
  firstRegionId,
  frontView,
  place,
  placeQuietly,
  regionInfos,
  removeView,
  regionNode,
  setCollapsed,
  setFront,
  setRegionChildren,
  setRegionSize,
  splitRegionWith,
} from "./model.js";
import type { LayoutStore } from "./store.js";

/** What {@link createServices} builds for the assembly to publish. */
export interface LayoutServices {
  /** DSH's layout face (the compat shim). */
  readonly layout: LayoutFace;
  /** prac's placement face. */
  readonly pracLayout: PracLayoutFace;
  /** The `panelInfo` root hook's observable. */
  readonly panelInfo: HostObservable<PanelInfo>;
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
  /** The arrangement's role bindings (empty until it binds them). */
  const roles: RoleBindings = {};

  /** Where a view parks when it gives up the centre (unbound until the arrangement says). */
  let trackRegion: string | undefined;

  /** The region new centre views go to: the frame's centre, or the first region without one. */
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
        const viewId = `${DSH_MAIN_PREFIX}${panelId ?? DSH_CONVERSATION_KEY}`;
        // The chosen view goes where the *arrangement* placed it, or to the
        // centre when it has no home of its own — never to "wherever the panel
        // on show happened to sit". A view parked in the track counts as having
        // no home: selecting it brings it back to the centre.
        const current = state.views[viewId]?.region;
        const regionId =
          current !== undefined && current !== trackRegion ? current : centreRegion(state);
        const outgoing = frontView(state, regionId);
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
        const regionId = state.views[viewId]?.region;
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
        const view = ensureView(state, viewId);
        const lowest = Math.min(0, ...Object.values(state.views).map((entry) => entry.order));
        return {
          ...state,
          views: { ...state.views, [viewId]: { ...view, hidden: false, order: lowest - 1 } },
        };
      });
    },
    closeRightbar(): void {
      const viewId = roles.secondarySidebar;
      if (viewId === undefined) return;
      store.update((state) => {
        const view = ensureView(state, viewId);
        return { ...state, views: { ...state.views, [viewId]: { ...view, hidden: true } } };
      });
    },
  };

  const pracLayout: PracLayoutFace = {
    getState: store.get,
    subscribe: store.subscribe,
    /** The union of the slot registry's views and each one's placement. */
    listViews(): ViewInfo[] {
      const state = store.get();
      return catalogueViewIds(ctx.slots).map((id) => {
        const record: ViewRecord | undefined = state.views[id];
        return record === undefined
          ? { id, region: null, hidden: true, order: null }
          : { id, region: record.region, hidden: record.hidden, order: record.order };
      });
    },
    /** The regions a view can be moved to (id + collapse state). */
    listRegions(): RegionInfo[] {
      return regionInfos(store.get().tree);
    },
    /** Move a view into a region and show it. */
    place(viewId: string, regionId: string): void {
      store.update((state) => place(state, viewId, regionId));
    },
    /** Move a view into a region without changing which child that region shows. */
    placeQuietly(viewId: string, regionId: string): void {
      store.update((state) => placeQuietly(state, viewId, regionId));
    },
    /** Forget a view's placement record (see the face's own note). */
    removeView(viewId: string): void {
      store.update((state) => removeView(state, viewId));
    },
    /** Give a region its child regions — the container shape. */
    setRegionChildren(regionId: string, children: readonly RegionChild[], label?: string): void {
      store.update((state) => {
        // A container's children **stack** their views: that is what a container
        // is for — grouping views that share one strip of screen.
        const nodes = children.map((child) =>
          regionNode(child.id, 0, { label: child.label, stack: true }),
        );
        const tree = setRegionChildren(state.tree, regionId, nodes, label);
        return tree === state.tree ? state : { ...state, tree };
      });
    },
    /** The child regions a region selects among. */
    regionChildren(regionId: string): RegionChild[] {
      const node = findRegion(store.get().tree, regionId);
      return (node?.children ?? []).map((child) => ({ id: child.id, label: child.label }));
    },
    setFront(viewId: string): void {
      store.update((state) => setFront(state, viewId));
    },
    /** Show/hide a view without moving it. */
    show(viewId: string): void {
      store.update((state) => {
        const view = ensureView(state, viewId);
        return { ...state, views: { ...state.views, [viewId]: { ...view, hidden: false } } };
      });
    },
    hide(viewId: string): void {
      store.update((state) => {
        const view = ensureView(state, viewId);
        return { ...state, views: { ...state.views, [viewId]: { ...view, hidden: true } } };
      });
    },
    setViewCollapsed(viewId: string, collapsed: boolean): void {
      store.update((state) => {
        const view = ensureView(state, viewId);
        return { ...state, views: { ...state.views, [viewId]: { ...view, collapsed } } };
      });
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
    splitView(viewId: string, side: Side): void {
      store.update((state) => {
        const record: ViewRecord | undefined = state.views[viewId];
        if (record === undefined) return state;
        const splitId = nextNodeId("split", state);
        const newRegionId = nextNodeId("region", state);
        const next = splitRegionWith(state, record.region, side, splitId, newRegionId);
        if (next === state) return state;
        return place(next, viewId, newRegionId);
      });
    },
    /**
     * Split a region in two without moving a view into it (see the face's doc).
     *
     * The tree edit is the same one `splitView` makes; what differs is that no view is
     * placed, so the new region starts empty and becomes visible when the app puts a view
     * there (which is exactly what the workbench's move/open into the new group produces).
     */
    regionInDirection(regionId: string, side: Side): string | undefined {
      return findRegionInDirection(store.get().tree, regionId, side);
    },
    createRegionBeside(regionId: string, side: Side): string | undefined {
      let created: string | undefined;
      store.update((state) => {
        const splitId = nextNodeId("split", state);
        const newRegionId = nextNodeId("region", state);
        const next = splitRegionWith(state, regionId, side, splitId, newRegionId);
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
    onDidRequestCloseView(listener: (viewId: string) => void): () => void {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    setViewFlags(viewId: string, flags: ViewFlags): void {
      store.update((state) => {
        const view = state.views[viewId];
        if (!view) return state;
        const next = { ...view.flags, ...flags };
        const same =
          (next.dirty ?? false) === (view.flags?.dirty ?? false) &&
          (next.preview ?? false) === (view.flags?.preview ?? false) &&
          (next.closable ?? false) === (view.flags?.closable ?? false);
        return same
          ? state
          : { ...state, views: { ...state.views, [viewId]: { ...view, flags: next } } };
      });
    },
    /** The centre region's front view: what prac is showing as active. */
    activeView(): string | null {
      const state = store.get();
      return frontView(state, centreRegion(state)) ?? null;
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

  return { layout, pracLayout, panelInfo };
}
