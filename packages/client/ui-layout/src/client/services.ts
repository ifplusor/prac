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
  type Dir,
  type LayoutFace,
  type PracLayoutFace,
  type RoleBindings,
  type ViewRecord,
} from "./contract.js";
import type { RegionInfo, ViewInfo } from "./catalogue.js";
import {
  ensureView,
  findRegion,
  firstRegionId,
  place,
  regionInfos,
  setCollapsed,
  setRegionSize,
  splitRegion,
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
export function createServices(ctx: Context, store: LayoutStore): LayoutServices {
  /** The arrangement's role bindings (empty until it binds them). */
  const roles: RoleBindings = {};

  /** Monotonic ids for regions and splits created after boot. */
  let nodeSeq = 0;
  const nextNodeId = (kind: string): string => `${kind}-${++nodeSeq}`;

  /**
   * Whether the `main` slot currently has an entry under this key.
   *
   * @param id - the main panel key.
   */
  const hasMainPanel = (id: string): boolean =>
    ctx.slots.entries("main").some((entry) => entry.options.key === id);

  let navigation = new AbortController();
  const layout: LayoutFace = {
    selectPanel(panelId: string | null): void {
      if (panelId !== null && !hasMainPanel(panelId)) {
        throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
      }
      navigation.abort();
      navigation = new AbortController();
      store.update((state) => {
        // The selected panel replaces whatever `main` view is on show, in the
        // same region it occupied — so "the centre" is derived from the
        // arrangement's placement, never from a hard-coded region id.
        const shown =
          state.views[`${DSH_MAIN_PREFIX}${state.activePanelId ?? DSH_CONVERSATION_KEY}`];
        const regionId = shown?.region ?? firstRegionId(state.tree);
        const viewId = `${DSH_MAIN_PREFIX}${panelId ?? DSH_CONVERSATION_KEY}`;
        return place({ ...state, activePanelId: panelId }, viewId, regionId);
      });
    },
    beginNavigation(): AbortSignal {
      navigation.abort();
      navigation = new AbortController();
      return navigation.signal;
    },
    toggleSidebar(): void {
      const viewId = roles.sidebar;
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
      const viewId = roles.rightbar;
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
      const viewId = roles.rightbar;
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
    /** Replace a region with a split of it and a new empty region. */
    split(regionId: string, dir: Dir = "row"): void {
      const splitId = nextNodeId("split");
      const newRegionId = nextNodeId("region");
      store.update((state) =>
        splitRegion(state, regionId, dir === "column" ? "column" : "row", splitId, newRegionId),
      );
    },
    /** Bind the roles DSH's borrowed vocabulary resolves through. */
    bindRoles(next: RoleBindings): void {
      if (next.sidebar !== undefined) roles.sidebar = next.sidebar;
      if (next.rightbar !== undefined) roles.rightbar = next.rightbar;
    },
  };

  // The `panelInfo` root hook: the active main panel drives the document
  // title and any panel-aware component.
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

  return { layout, pracLayout, panelInfo };
}
