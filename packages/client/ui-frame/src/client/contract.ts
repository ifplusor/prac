import type {
  ApplicationSlotRenderer,
  BoardLayoutSource,
  RegionBinding,
  ItemKind,
  WindowGroup,
  GroupRegionContent,
  RegionContentRegistry,
  WidgetRecord,
  LayoutState,
} from "prac-ui-kit-workbench";
import type {
  ChromeRegistry,
  ContentHost,
  ContentInfo,
  ItemFlags,
  RegionInfo,
} from "prac-ui-kit-content";
import type { ReactNode } from "react";

import type { RegionChild, RegionSelector, Side } from "prac-ui-kit-layout";
/**
 * The frame plugin's DSH contract.
 *
 * Everything that names DSH lives here, not in `prac-ui-kit-workbench`: the prac
 * slots merged into DSH's `SlotMap`, and the `Context` faces the frame
 * publishes (`ctx.pracFrame`, `ctx.pracSpaces`, `ctx.pracWindowActions`,
 * `ctx.pracSurfaces`). Consumers name this module (type-only) for the merges;
 * the layout vocabulary itself stays in the kit.
 *
 * @module prac-client-ui-frame/client/contract
 */

import { WIDGET_SLOT, WINDOW_SLOT } from "./catalogue.js";
// Type-only, for the modules whose declaration merges this file augments.
import type {} from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-slots";

// Re-exported so the declaration artifact imports the real modules before it
// augments them; a bare `declare module` alone lets a consumer see only the
// merged members (no `ctx.effect` / `ctx.provide`).
export type { Context } from "@deepseek-ai/cordis";
export type { SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { ApplicationRegistry } from "prac-ui-kit-workbench";

import type { WindowManager } from "./window-manager.js";

/** One view and where it currently sits. */
export interface ItemInfo extends ContentInfo {
  readonly kind: "window" | "widget";
}

/** A slot key a prac content surface registers its item into. */
export type PracSlotKey = typeof WINDOW_SLOT | typeof WIDGET_SLOT;

// The merges reach this program through the **type-only** imports above. Do not
// "make it explicit" with side-effect imports here: a bare `import "@deepseek-ai/…"`
// in a `.ts` module is a *runtime* import, and the bundler will inline that
// package into the client artifact. Inside a `.d.ts` it is erased; in a module
// it is not.

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** Window content: file / chat / board window content. */
    "prac.window": { kind: "list"; scope: "root" };
    /** Widget content: VS Code view / DSH widget content. */
    "prac.widget": { kind: "list"; scope: "root" };
    // The child slots of the `root` slot prac registers — declared by their
    // **owner**, which is the frame (see the `ui-slots` contract: a slot table is
    // merged by the plugin that owns the slot, and reading entries stays
    // string-keyed and dynamic). prac owns the frame here: it publishes
    // `ctx.layout` and makes the one `root` registration, so these four belong to
    // the plugin rather than being borrowed from DSH's own `ui-layout`.
    sidebar: { kind: "single"; scope: "root" };
    main: { kind: "keyed"; scope: "root" };
    rightbar: { kind: "single"; scope: "root" };
    "shell.overlay": { kind: "list"; scope: "root" };
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The frame's placement face. */
    pracFrame: PracLayoutFace;
    /** App definitions partners contribute (launch identity + per-window content). */
    pracApplications: ApplicationRegistry;
    /** Window membership: which group holds a window, and the membership operations. */
    pracWindows: WindowManager;
    /** The Space registry: named layouts over the same project folder. */
    pracSpaces: PracSpacesFace;
    /** The active window's resolved actions, rendered in the tab strip. */
    pracWindowActions: PracWindowActionsFace;
    /** The partner registry: a base partner contributes app / widget entries. */
    pracPartners: PracPartnersFace;
    /** The frame's surface socket registry. */
    pracSurfaces: RegionContentRegistry<WindowGroup>;
  }
}

/** One Space: a named layout other plugins can switch to. */
export interface SpaceInfo {
  readonly id: string;
  readonly name: string;
}

/** One resolved action a window offers (the adapter's model, frame-rendered). */
export interface WindowAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly tooltip?: string;
  readonly submenu?: readonly WindowAction[];
}

/** The model the frame renders at the tab strip: primary inline, secondary overflow. */
export interface WindowActionModel {
  readonly primary: readonly WindowAction[];
  readonly secondary: readonly WindowAction[];
}

/** The frame's window-action registry (keyed by view id). */
/** One thing a base partner contributes to prac. */
export interface PracContribution {
  /** Global id (`vscode:view:*`, `dsh:main:*`, `vscode:file:*`). */
  readonly id: string;
  /**
   * `app` — the contribution opens windows through the application layer;
   * `widget` — it is a composable unit a board renders. A window is prac's
   * **instance**, never the partner's unit of contribution.
   */
  readonly kind: "app" | "widget";
  readonly label?: string;
  readonly icon?: string;
  /** The content brings its own native header; the frame must not draw a second row. */
  readonly paneHeader?: boolean;
  /** The contribution's own actions; they ride the registration (not a separate seat). */
  readonly actions?: () => ReactNode;
}

/** An app a partner contributes, with the window instances it currently wants open. */
export interface PracPartnerApplication {
  readonly id: string;
  readonly label: string;
  readonly instances: "single" | "multi";
  readonly defaultRegion?: string;
  /** The content brings its own native header (the frame overlays controls only). */
  readonly paneHeader?: boolean;
  /** One window's content; resolved per instance id. */
  content(windowId: string, render?: ApplicationSlotRenderer): () => ReactNode;
  /** The instances the partner wants open right now. */
  windows(): readonly { readonly id: string; readonly title: string }[];
}

/** A base partner (VS Code, DSH) and how prac reads what it contributes. */
export interface PracPartner {
  /** Which base partner this plugin contributes to. */
  readonly name: PracPartnerName;
  contributions(): readonly PracContribution[];
  onDidChange(listener: () => void): () => void;
  /**
   * One contribution's content.
   *
   * Resolved once per **registration**, never per render: a fresh component on
   * every render would remount the whole view and its header.
   */
  hostFor(id: string): () => ReactNode;
  /** The partner's own wrapping of a contribution (e.g. observing its pane title). */
  wrap?(contribution: PracContribution, host: () => ReactNode): () => ReactNode;
  /** The apps the partner contributes, with their current window instances. */
  applications?(): readonly PracPartnerApplication[];
}

/**
 * The base partners. There are exactly two, and each is a **group of plugins**
 * (VS Code: the views and editor plugins; DSH: its host), not one plugin.
 */
export type PracPartnerName = "vscode" | "dsh";

/** The partner registry the frame provides. */
export interface PracPartnersFace {
  /** Join a base partner; several plugins may register under the same name. */
  register(partner: PracPartner): () => void;
  /** The base partners currently joined, with their provider count. */
  partners(): readonly { readonly name: PracPartnerName; readonly providers: number }[];
}

export interface PracWindowActionsFace {
  /** Set (or replace) the model for one view. */
  set(viewId: string, model: WindowActionModel, run: (id: string) => void): void;
  /** Remove the model for one view. */
  remove(viewId: string): void;
  /** The model for one view, if any. */
  get(viewId: string): { model: WindowActionModel; run: (id: string) => void } | undefined;
  /** Subscribe to changes. */
  subscribe(listener: () => void): () => void;
}

/** The Space registry face (`ctx.pracSpaces`). */
export interface PracSpacesFace {
  /** Every Space, in switcher order. */
  list(): readonly SpaceInfo[];
  /** The active Space's id. */
  active(): string;
  /** Make another Space active. */
  switchTo(id: string): void;
  /** Create a Space; returns its id. */
  create(name?: string): string;
  /** Rename a Space. */
  rename(id: string, name: string): void;
  /** Remove a Space; the last one cannot be removed. */
  remove(id: string): void;
  /** Subscribe to registry changes. */
  onDidChange(listener: () => void): () => void;
}

export interface LayoutFace {
  /**
   * The selected global central panel — the same source the `panelInfo` root hook reads.
   *
   * Upstream's `ILayout` carries it, and its plugins reach for it through `ctx.layout`
   * (measured: upstream's right-sidebar plugin reads
   * `layout.panelInfo.getSnapshot().activePanelId` while it activates, and this face
   * without it took the whole shell down — 12 entries failed to activate).
   */
  readonly panelInfo: {
    getSnapshot(): { readonly activePanelId: string | null };
    subscribe(listener: () => void): () => void;
  };
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
  /** The view that plays the **primary sidebar** role (`dsh:sidebar` in prac's
   * arrangement): borrowed from VS Code's own role name, because the role is not a
   * position — upstream lets the primary side bar move to the right. */
  primarySidebar?: string;
  /** The view that plays the **secondary sidebar** role (`dsh:rightbar` in prac's
   * arrangement; VS Code calls this location `AuxiliaryBar`, shown as "Secondary
   * Side Bar"). */
  secondarySidebar?: string;
}

/**
 * prac's own face (`ctx.pracFrame`): the placement model itself.
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
   * Read live from the slot registry, so a `main` key or a `prac.window` /
   * `prac.widget` entry registered later appears here; the returned order is
   * deterministic.
   *
   * @returns one entry per known view (placed or not).
   */
  listItems(): ItemInfo[];
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
   * Put a view in a region **without** changing which child its region shows.
   *
   * The bulk path: the source catalogue is the truth about what exists, but the
   * person's choice of container is theirs.
   *
   * @param viewId - the view identity.
   * @param regionId - the destination region.
   */
  placeQuietly(viewId: string, regionId: string): void;
  /**
   * Forget a view's placement record.
   *
   * The difference between **hiding** a view and forgetting it is who still owns the
   * subject: a hidden view is one the person put away and can bring back, while a
   * forgotten one has nothing left to come back to (a file view whose file the app no
   * longer has open). The record is what the frame persists, so a stale one is also what
   * would block the same view id from being placed again.
   *
   * @param viewId - the view identity.
   */
  removeItem(viewId: string): void;
  /**
   * Give a region its child regions — the **container** shape.
   *
   * A region whose children are regions shows one of them at a time (see
   * {@link RegionNode.children}); the children carry the container names. The
   * selector's own recorded choice is kept while it still names a child.
   *
   * The child's node itself is the mechanism's business, so callers name ids and
   * labels and the shape is built here.
   *
   * @param regionId - the selector region.
   * @param children - the child regions, in bar order.
   * @param label - an optional display name for the selector itself.
   */
  setRegionChildren(regionId: string, children: readonly RegionChild[], label?: string): void;
  /**
   * The child regions a region currently selects among.
   *
   * Empty for a region that holds items; the arrangement uses this to keep the
   * children it does not own (prac's own items) when it rebuilds the containers.
   *
   * @param regionId - the region to inspect.
   */
  regionChildren(regionId: string): RegionChild[];
  /**
   * Set how a region presents its choice among its children.
   *
   * The geometry follows the kind: `"rail"` reserves no strip inside the region (the rail is
   * outside it), `"title"` reserves the strip the frame draws, `"none"` reserves nothing.
   *
   * @param regionId - the region to configure.
   * @param selector - the presentation to use from now on.
   */
  setRegionSelector(regionId: string, selector: RegionSelector): void;
  /**
   * Bring one of a region's children to the front.
   *
   * This is what a dock rail's click does: the rail names a container, and selecting that container
   * is a layout operation, not a click on a hidden strip.
   *
   * @param regionId - the region whose child is selected.
   * @param childId - the child to show.
   */
  selectContainer(regionId: string, childId: string): void;
  /**
   * The child a region currently shows, or null when it selects among no children.
   *
   * A dock rail asks this to mark the container it is showing; it is the same answer the frame
   * renders, so the rail and the pane cannot disagree.
   *
   * @param regionId - the region to inspect.
   */
  activeContainer(regionId: string): string | null;
  /**
   * Show a view without moving it.
   *
   * @param viewId - the view identity.
   */
  show(viewId: string): void;
  /**
   * Make a view the front of its region, **without moving it in the strip**.
   *
   * The channel a consumer uses to say "the app's current file is this one": the tab
   * strip keeps its open order (VS Code's do) while what the region renders follows.
   * Idempotent, so a consumer may call it whenever it syncs.
   *
   * @param viewId - the view to bring to the front.
   */
  setFront(viewId: string): void;
  /**
   * Hide a view without moving it.
   *
   * @param viewId - the view identity.
   */
  hide(viewId: string): void;
  /** Classify an existing view as a window or a widget (model discriminator). */
  setItemKind(viewId: string, kind: ItemKind): void;
  /** Register a content host for a window; returns the unregister function. */
  registerContentHost(contentId: string, host: ContentHost): () => void;
  /** Register a board layout root for a board window; returns the unregister function. */
  registerBoardLayout(
    boardId: string,
    source: BoardLayoutSource | LayoutState<WidgetRecord>,
    chrome?: ChromeRegistry<WidgetRecord>,
  ): () => void;
  /** Point a window record at a board layout root (or clear it). */
  setItemBoard(viewId: string, boardId: string | undefined): void;
  registerWindowGroup(group: WindowGroup, regionId: string): RegionBinding;
  registerContent(content: GroupRegionContent<WindowGroup>, regionId: string): RegionBinding;
  /**
   * Remove a view group's frame projection.
   *
   * @param groupId - the view-group id.
   */
  unregisterWindowGroup(groupId: string): void;
  /**
   * Fold a view's body away inside a stack, keeping its header.
   *
   * Only stacked regions render the state; elsewhere it is remembered for when
   * the view lands in one.
   *
   * @param viewId - the view identity.
   * @param collapsed - the requested state.
   */
  setItemCollapsed(viewId: string, collapsed: boolean): void;
  /** Declare the height a view wants as a stack row; the layout only reads it. */
  setItemSize(viewId: string, size: number): void;
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
   * Split a view out into a new region on one side of the region holding it.
   *
   * The vector is **view-centric on purpose**: the mechanism creates the region
   * *for* a view, so a split can never produce an empty region (decision 15:
   * 分栏必带视图). The view must already be placed; an unplaced (or unknown) view
   * is a no-op rather than an error — the caller is a user action, not a
   * programming contract.
   *
   * The source region keeps its size when it is fixed and its remaining items;
   * when it is flexible both regions share the split evenly.
   *
   * @param viewId - the view to move into the new region.
   * @param side - which side of its current region the new region goes on.
   */
  splitItem(viewId: string, side: Side): void;
  /**
   * Swap two cells of a grid.
   *
   * @param gridId - the grid.
   * @param cellId - the dragged cell.
   * @param targetId - the cell it is dropped on.
   */
  moveGridCell(gridId: string, cellId: string, targetId: string): void;
  /**
   * Merge two adjacent grid cells into one split cell, keeping both regions.
   *
   * @param gridId - the grid.
   * @param sourceId - the cell folded into the target.
   * @param targetId - the cell that survives.
   */
  mergeGridCells(gridId: string, sourceId: string, targetId: string): void;
  /**
   * Split a merged grid cell back into the cells its split holds.
   *
   * @param gridId - the grid.
   * @param cellId - the merged cell.
   */
  unmergeGridCell(gridId: string, cellId: string): void;
  /**
   * Resize a cell's span. A span that overlaps another cell is refused.
   *
   * @param gridId - the grid.
   * @param cellId - the cell.
   * @param rowSpan - requested rows.
   * @param columnSpan - requested columns.
   */
  resizeGridCell(gridId: string, cellId: string, rowSpan: number, columnSpan: number): void;
  /**
   * Set one grid track's relative weight.
   *
   * @param gridId - the grid.
   * @param axis - column or row.
   * @param index - zero-based track.
   * @param weight - positive relative weight.
   */
  setGridTrackWeight(gridId: string, axis: "column" | "row", index: number, weight: number): void;
  /**
   * Drag a boundary between two grid tracks.
   *
   * @param gridId - the grid.
   * @param axis - column or row.
   * @param boundary - zero-based track to grow.
   * @param delta - pointer movement along the axis, in pixels.
   * @param extent - grid pixel extent along the axis.
   */
  resizeGridTrack(
    gridId: string,
    axis: "column" | "row",
    boundary: number,
    delta: number,
    extent: number,
  ): void;
  /**
   * Split a region in two **without moving a view into it**, and report the new region's id.
   *
   * This is the workbench's channel for `addGroup`: VS Code's editor part asks for a *group*
   * in a direction, and in prac a group is a region, so the group cannot exist before the
   * region does. The id is handed back synchronously (the frame's tree is a store update) so
   * the caller can bind the group it is about to create to the region that now renders it —
   * the file view the app places there mounts into that same region and finds that group.
   *
   * @param regionId - the region to split.
   * @param side - which side of it the new region goes on.
   * @returns the new region's id, or undefined when the region is unknown or the split is a no-op.
   */
  createRegionBeside(regionId: string, side: Side): string | undefined;
  /**
   * Remove a region from the tree — the inverse of {@link createRegionBeside}.
   *
   * The embedder asks for this when an editor group it created is gone. Views that lived in
   * the removed region are dropped with it, and the **root region is never removed**: some
   * region has to hold the screen.
   *
   * @param regionId - the region to remove.
   */
  removeRegion(regionId: string): void;
  /**
   * The region adjacent to another one in a direction, or undefined when there is none.
   *
   * The frame owns the region tree, so this is where a directional question ("the group to
   * the left") can be answered at all; the workbench's directional `findGroup` asks through it.
   *
   * @param regionId - the region to look from.
   * @param side - the direction to look in.
   * @returns the neighbouring region's id.
   */
  regionInDirection(regionId: string, side: Side): string | undefined;
  /**
   * Set (merge) the chrome flags of a view.
   *
   * The declarer's channel: the mechanism renders a tab dot for `dirty` and an
   * italic label for `preview`, and never asks where the fact came from.
   *
   * @param viewId - the view identity.
   * @param flags - the flags to merge into the view's record.
   */
  setItemFlags(viewId: string, flags: ItemFlags): void;
  /**
   * Subscribe to "the person asked to close this view".
   *
   * Raised by the chrome's close affordance; the declarer decides what closing means and
   * does it (a file's declarer closes the app's editor, which retracts the view). The
   * frame never removes a view on its own: `hide` exists for taking one off screen.
   *
   * @param listener - called with the view id.
   * @returns a function that unsubscribes.
   */
  onDidRequestCloseItem(listener: (viewId: string) => void): () => void;
  /**
   * The view the mechanism considers active: the front view of the centre region.
   *
   * A generic fact, not a view name — a UI that wants "bring the app in step with
   * what prac shows" reads this rather than re-deriving which region is the centre.
   *
   * @returns the view id, or null when the centre shows nothing.
   */
  activeItem(): string | null;
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
