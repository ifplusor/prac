/**
 * The layout vocabulary: the region/split tree, the views table's shapes, and the
 * faces this mechanism publishes.
 *
 * Layer 0 of the client half — it imports nothing from the other domains, so
 * every module (model, store, frame, services) can speak these types without
 * depending on each other.
 *
 * @module prac-client-ui-layout/client/contract
 */

import type { RegionInfo, ViewInfo } from "./catalogue.js";

// DSH's declaration merges reach this program through the **type-only** imports
// the other modules already make (`PropsRenderSlots` from ui-slots,
// `HostObservable` from ui-renderer, `PanelInfo`/`UsePanelInfo` from ui-layout,
// `ThemeSnapshot` from ui-theme, `UseSessions` from ui-session). Do not "make it
// explicit" with side-effect imports here: a bare `import "@deepseek-ai/…"` in a
// `.ts` module is a *runtime* import, and the bundler will inline that package
// into the client artifact (measured: 40 kB → 218 kB, loader check red). Inside a
// `.d.ts` it is erased; in a module it is not.

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** prac's seat: a `root`-scoped list slot every prac surface declares one view into. */
    "prac.view": { kind: "list"; scope: "root" };
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The mechanism's placement face, for other prac plugins (the arrangement). */
    pracLayout: PracLayoutFace;
  }
}

/** Split axis: `row` distributes width, `column` distributes height. */
export type Dir = "row" | "column";

/** A sized seat for one visible view. */
export interface RegionNode {
  readonly type: "region";
  readonly id: string;
  /** Size along the parent split's axis, in px (fixed regions only). */
  size: number;
  /** Whether the region absorbs the split's free space rather than a fixed size. */
  flex: boolean;
  /** Whether the region renders at 0px while staying present. */
  collapsed: boolean;
  /** The size to restore when expanding. */
  cachedSize: number;
  /** Smallest size this region may be squeezed to, in px. */
  min: number;
  /**
   * Whether the region **stacks** all its visible views instead of showing only
   * the front one.
   *
   * A stack shows a header per view (with a fold toggle) once it holds more than
   * one visible view; with exactly one it renders it bare, so a single-view
   * region looks and measures the same either way.
   */
  readonly stack?: boolean;
}

/** A flex container of children along one axis. */
export interface SplitNode {
  readonly type: "split";
  readonly id: string;
  readonly dir: Dir;
  readonly children: LayoutNode[];
}

/** One node of the region tree. */
export type LayoutNode = RegionNode | SplitNode;

/** Where one view sits, and in what order inside its region. */
export interface ViewRecord {
  region: string;
  order: number;
  hidden: boolean;
  /** Whether the view's body is folded away inside a stack (its header stays). */
  collapsed?: boolean;
}

/** The whole layout store state (replaced immutably on every update). */
export interface LayoutState {
  /** Measured frame width, in px (0 until the first measurement). */
  viewportWidth: number;
  /** Measured frame height, in px. */
  viewportHeight: number;
  /** The region tree. */
  tree: LayoutNode;
  /** The view table: `viewId → placement`. */
  views: Record<string, ViewRecord>;
  /**
   * Bumped whenever the slot registry's view registrations change. The view
   * *table* only moves when the arrangement acts; the *catalogue* also moves
   * when a plugin registers a `main` key or a `prac.view` entry, and this is
   * how a subscribed UI learns to re-read {@link PracLayoutFace.listViews}.
   */
  catalogueVersion: number;
  /** DSH's selected main key; null means the conversation. */
  activePanelId: string | null;
}

/** A resolved region box for one viewport. */
export interface Box {
  width: number;
  height: number;
}

/** Inline style values this frame emits. */
export type StyleObject = Record<string, string | number>;

/** A box standing in for a region the resolver has not measured yet. */
export const ZERO_BOX: Box = { width: 0, height: 0 };

/** Width/height of a sash in px. Kept in step with FRAME_STYLES. */
export const SASH_SIZE = 5;
/** A region's minimum size in px unless it declares its own. */
export const DEFAULT_MIN = 120;
/** The centre work area stays wider than a side track can usefully be. */
export const CENTER_MIN = 240;
/**
 * The frame's default centre region.
 *
 * Where a main panel goes when the arrangement placed it nowhere: the centre is
 * the frame's own default, and the arrangement is free to place the same view
 * somewhere else (see {@link PracLayoutFace.selectPanel}).
 */
export const CENTER_REGION = "stage";
/**
 * The frame's bottom bar.
 *
 * It sits under the whole row of side regions — the home of a terminal, output,
 * problems: things that are about the workspace rather than about one region.
 * It is empty at boot, and an empty region is not rendered at all, so the
 * default layout is exactly the row; the arrangement (or the user) fills it.
 */
export const BOTTOM_REGION = "bottom";

export interface LayoutFace {
  /**
   * Select a global central panel.
   *
   * The chosen view goes where the arrangement placed *it* (its own region), or
   * to the centre when it has none — never to "wherever the panel on show
   * happened to sit". Whatever held that region gives it up and parks in the
   * track ({@link PracLayoutFace.bindTrack}) when one is bound, so a panel and
   * the conversation can stay on screen together instead of replacing each
   * other.
   *
   * @param panelId - a registered main key, or null for the conversation.
   * @throws when the key is not registered.
   */
  selectPanel(panelId: string | null): void;
  /** Start an asynchronous navigation, superseding any earlier pending one. */
  beginNavigation(): AbortSignal;
  /**
   * Collapse the region currently holding the view bound to the `sidebar`
   * role (or restore it). A no-op until the arrangement binds that role.
   */
  toggleSidebar(): void;
  /**
   * Show the view bound to the `rightbar` role and bring it to the front.
   *
   * @param track - whether the panel reserves a track (ignored: the region
   *   holding the role view hosts whatever the arrangement placed there).
   * @param fullscreen - whether the panel covers the frame (ignored).
   */
  openRightbar(track: boolean, fullscreen: boolean): void;
  /** Hide the view bound to the `rightbar` role. */
  closeRightbar(): void;
}

/**
 * The roles the arrangement binds: a role name is how DSH's borrowed vocabulary
 * reaches a concrete view without the mechanism naming any view itself.
 *
 * There is deliberately no default: an unbound role makes its shim methods
 * no-ops rather than guessing a view.
 */
export interface RoleBindings {
  /** The view that plays the sidebar role (`dsh:sidebar` in prac's arrangement). */
  sidebar?: string;
  /** The view that plays the rightbar role (`dsh:rightbar` in prac's arrangement). */
  rightbar?: string;
}

/**
 * prac's own face (`ctx.pracLayout`): the placement model itself.
 *
 * This is what makes "any view in any region" a capability rather than a layout
 * we happen to have hard-coded.
 */
export interface PracLayoutFace {
  /** The current layout state (a snapshot; do not mutate). */
  getState(): LayoutState;
  /**
   * Subscribe to layout state replacements.
   *
   * @param listener - called after every accepted update.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
  /**
   * The view catalogue: every view the frame knows about and where each one
   * currently sits.
   *
   * Read live from the slot registry, so a `main` key or `prac.view` entry
   * registered later appears here; the returned order is deterministic.
   *
   * @returns one entry per known view (placed or not).
   */
  listViews(): ViewInfo[];
  /**
   * The region ids a view can be moved to, in tree order.
   *
   * @returns every current region.
   */
  listRegions(): RegionInfo[];
  /**
   * Move a view into a region and show it.
   *
   * @param viewId - the view identity.
   * @param regionId - the destination region.
   */
  place(viewId: string, regionId: string): void;
  /**
   * Show a view without moving it.
   *
   * @param viewId - the view identity.
   */
  show(viewId: string): void;
  /**
   * Hide a view without moving it.
   *
   * @param viewId - the view identity.
   */
  hide(viewId: string): void;
  /**
   * Fold a view's body away inside a stack, keeping its header.
   *
   * Only stacked regions render the state; elsewhere it is remembered for when
   * the view lands in one.
   *
   * @param viewId - the view identity.
   * @param collapsed - the requested state.
   */
  setViewCollapsed(viewId: string, collapsed: boolean): void;
  /**
   * Collapse a region to nothing (remembering its size) or restore it.
   *
   * @param regionId - the region id.
   * @param collapsed - the requested state.
   */
  setCollapsed(regionId: string, collapsed: boolean): void;
  /**
   * Resize a fixed region.
   *
   * @param regionId - the region id.
   * @param width - requested size in px.
   */
  setWidth(regionId: string, width: number): void;
  /**
   * Replace a region with a split of it and a new empty region.
   *
   * @param regionId - the region to split.
   * @param dir - the new split's axis (defaults to `row`).
   */
  split(regionId: string, dir?: Dir): void;
  /**
   * Bind the roles DSH's borrowed vocabulary resolves through. Supplied by the
   * arrangement; the mechanism itself names no view. Later bindings win, and a
   * role omitted from `roles` keeps its current binding.
   *
   * @param roles - role name → view id.
   */
  bindRoles(roles: RoleBindings): void;
  /**
   * Bind the region a view parks in when it gives up the centre.
   *
   * Supplied by the arrangement, like the roles: the mechanism decides *that*
   * one view holds a region, the arrangement decides *where* the one that yields
   * goes. Unbound, a displaced view simply stays placed behind the new front.
   *
   * @param regionId - the parking ("track") region id.
   */
  bindTrack(regionId: string): void;
}

/**
 * Install the frame and its services on the Cordis client context.
 *
 * @param ctx - the Cordis client context.
 */
