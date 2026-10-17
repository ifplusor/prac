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
    /** prac's slot: a `root`-scoped list slot every prac surface declares one view into. */
    "prac.view": { kind: "list"; scope: "root" };
    // The child slots of the `root` slot prac registers — declared by their **owner**, which
    // is the frame (see the `ui-slots` contract: a slot table is merged by the plugin that
    // owns the slot, and reading entries stays string-keyed and dynamic). prac owns the frame
    // here: it publishes `ctx.layout` and makes the one `root` registration, so these four
    // belong in this package rather than being borrowed from DSH's own `ui-layout` — a
    // consumer that reads a key owned by another package would have to have that package's
    // declarations in the same module record, which is exactly the kind of coupling this
    // ownership split removes.
    sidebar: { kind: "single"; scope: "root" };
    main: { kind: "keyed"; scope: "root" };
    rightbar: { kind: "single"; scope: "root" };
    "shell.overlay": { kind: "list"; scope: "root" };
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

/**
 * Which side of a region a new sibling goes on. The axis follows from the side
 * (`left`/`right` split a row, `up`/`down` a column), so one word carries both
 * the direction and the ordering — there is no "split without a side" that
 * could leave the caller to guess where the new region landed.
 */
export type Side = "left" | "right" | "up" | "down";

/**
 * How hard a region is to squeeze when the split it lives in has to change size.
 *
 * The values and their meaning are VS Code's `LayoutPriority`: a view with **higher** priority is
 * resized first, so when space runs short the high-priority one gives way first and the low-priority
 * ones keep their size. The convention the arrangement follows is VS Code's own —
 * `editorPart = High`, `sidebarPart = Low`.
 */
export type LayoutPriority = "normal" | "low" | "high";

/**
 * How dragging a sash moves the space.
 *
 * - `"distribute"` (VS Code's `DistributeSizing`, the default): every block on the axis absorbs the
 *   change **in proportion**, each clamped to its own `min` / `max`;
 * - `"expand"`: only the neighbour is pushed, one block at a time (VS Code `SplitView.resize`).
 */
export type Sizing = "distribute" | "expand";

/** A sized region for one visible view. */
export interface RegionNode {
  readonly type: "region";
  readonly id: string;
  /** Size along the parent split's axis, in px (fixed regions only). */
  size: number;
  /** Whether the region absorbs the split's free space rather than a fixed size. */
  flex: boolean;
  /**
   * Whether the region renders at 0px while staying present.
   *
   * A **stack row** (`entry`) is the exception: it is a header, drawn at `STACK_HEADER_HEIGHT`, and its
   * `size` is 0 rather than a height (the design's E1/J3). An ordinary region collapses to 0.
   */
  collapsed: boolean;
  /** The size to restore when expanding. */
  cachedSize: number;
  /** Smallest size this region may be squeezed to, in px. */
  min: number;
  /**
   * Largest size this region may grow to, in px.
   *
   * Absent means "no bound of its own" (VS Code's `maximumSize` defaults to infinity). The layout
   * only reads it — a view that wants a ceiling declares one.
   */
  readonly max?: number;
  /** How hard this region is to squeeze; absent means `"normal"`. */
  readonly priority?: LayoutPriority;
  /**
   * Whether a drag may take this region away entirely (VS Code's `IView.snap`).
   *
   * With it, dragging the boundary past the region's own limit **hides** the region — its size is
   * remembered, so dragging back brings it in again. Without it the region only ever gets smaller.
   */
  readonly snap?: boolean;
  /**
   * Whether the region **stacks** all its visible views instead of showing only
   * the front one.
   *
   * A stack shows a header per view (with a fold toggle) once it holds more than
   * one visible view; with exactly one it renders it bare, so a single-view
   * region looks and measures the same either way.
   */
  readonly stack?: boolean;
  /**
   * Whether the region shows an **editor-group-style tab strip**, borrowed from
   * VS Code's `workbench.editor.showTabs`:
   *
   * - `"multiple"` (VS Code's default): the strip is shown even for a single
   *   view, so the region always reads as "these are the things open here";
   * - `"single"`: only once the region holds more than one, which is what a
   *   prac *stack* does with its headers;
   * - `"none"`: never.
   *
   * Absent means no tab strip: the region renders bare (one view) or as a stack
   * (several), which is what the side tracks and the bottom bar do. A tab strip
   * is the group's chrome, so a region has at most one of the two: tabs replace
   * the fold headers, whose per-view fold is a stack idea.
   */
  readonly tabs?: TabMode;
  /**
   * Whether the **embedder** created this region for an editor group.
   *
   * A marked region is a group's home, and a group is removed when its last editor closes — so
   * a marked region that holds nothing is the leftover of a session whose files are gone (files
   * are not restored across a reload): it has no group to close and no chrome to close it with,
   * and the boot drops it. Unmarked regions are never pruned — the arrangement's tracks and the
   * regions a **view** split made are the app's own shape, and one of those being empty at load
   * only means its view has not been placed yet.
   */
  readonly embedder?: boolean;
  /**
   * This region is one row of a stack — a leaf the normalizer made, holding exactly one view.
   *
   * It lets the frame tell a stack row (which draws a header and can be folded) from an ordinary
   * region (which does not), without sniffing at the id.
   */
  entry?: boolean;
  /**
   * Child regions, when this region **selects** among them instead of holding
   * views directly.
   *
   * A region's children may be views or regions; this is the region case. The
   * children are shown **one at a time** (the "选择" mode) — which is what a
   * borrowed **container** is: a named child region, selected among its sibling
   * containers. A region with no children holds views, as before.
   */
  /**
   * The regions this one chooses between (one at a time, `active` names the chosen one).
   *
   * A child may also be a **split**: a stack turns the region that held its views into a `column`
   * split (`ensureStackShape`), and that split takes the region's place in its parent's list. The
   * parent still chooses by id (`active`), so it does not care what kind of subtree it chose.
   */
  readonly children?: readonly LayoutNode[];
  /**
   * Which child is shown, by id.
   *
   * Absent means "the first present child", so a fresh tree needs no selection
   * of its own. Set by whatever brings a child forward (the container bar, or
   * the arrangement placing a view into that child).
   */
  readonly active?: string;
  /**
   * A display name, when the region has one.
   *
   * The borrowed container's title lands here: the region is the container, and
   * the name is what its entry in the container bar reads.
   */
  readonly label?: string;
}

/** How many visible views a region needs before it shows a tab strip. */
export type TabMode = "multiple" | "single" | "none";

/**
 * A child region a caller asks for: an id and a display name.
 *
 * Deliberately smaller than {@link RegionNode}: the arrangement names its
 * containers, the mechanism builds the nodes.
 */
export interface RegionChild {
  /** The child region's id. */
  readonly id: string;
  /** The name its entry in the container bar reads. */
  readonly label?: string;
}

/** A flex container of children along one axis. */
export interface SplitNode {
  readonly type: "split";
  readonly id: string;
  readonly dir: Dir;
  /**
   * What the split takes along its parent's axis.
   *
   * Optional, and **absent means "share the leftover"** — which is what every split in the frame's
   * default tree wants. A split that has to stand in for a fixed-size region (a stack replacing a
   * named region, say) carries that region's `size` and `flex: false` instead. Upstream's own
   * serialized branch has a `size` for the same reason (`grid.ts:764-769`).
   */
  readonly size?: number;
  readonly flex?: boolean;
  /** Largest extent this split may grow to; absent means no bound. */
  readonly max?: number;
  /** How hard this split is to squeeze; absent means `"normal"`. */
  readonly priority?: LayoutPriority;
  /**
   * The display name of the **region this split stands in for**.
   *
   * A stack takes a region's place and keeps its id, so it has to keep its name as well: the bar that
   * switches between a region's children reads labels, and a container that became a stack without one
   * would show up as its raw id.
   */
  readonly label?: string;
  /** Whether a drag may take this split away entirely (see {@link RegionNode.snap}). */
  readonly snap?: boolean;
  readonly children: LayoutNode[];
}

/** One node of the region tree. */
export type LayoutNode = RegionNode | SplitNode;

/** Where one view sits, and in what order inside its region. */
export interface ViewRecord {
  /**
   * The height this view **declares** for its row, or the height a lone (melted) view keeps while
   * it has no row. A row's authoritative height is the leaf's `size`; this field only seeds it and
   * waits while the view is not a row. Absent means "no claim" (share the remaining height); while
   * the view is **folded** this is 0/not a height, and what it remembers lives in `cachedSize`
   * (VS Code keeps `size` and `_cachedVisibleSize` apart, `splitview.ts:221-246`).
   */
  size?: number;
  /**
   * The height a **folded** row remembers, so unfolding puts it back where it was.
   *
   * Upstream's `_cachedVisibleSize`: written when the row hides (`splitview.ts:237`), read back
   * through `clamp(cached, view.min, view.max)` when it shows again (`:234`), and carried in the
   * serialized state (`:273-277`).
   */
  cachedSize?: number;
  /**
   * This view's ceiling in a stack, if it declares one.
   *
   * The interface is the design (`IView.maximumWidth/maximumHeight`, `splitview.ts:60`); a hidden
   * view counts as 0 (`:254-255`). Nothing declares one yet: VS Code's own viewlets do not, so a
   * row that can grow takes the free room. Without a ceiling the room goes to the last capable row
   * first — the order `distributeEmptySpace` uses (`splitview.ts:1349-1355`).
   */
  max?: number;
  region: string;
  /**
   * The region's open order.
   *
   * A stack stores the same order in its split's children and renumbers this field on a reorder
   * (F7), so the tab strip and the stack cannot drift when a region changes mode.
   */
  order: number;
  hidden: boolean;
  /**
   * Whether the view's body is folded away inside a stack (its header stays).
   *
   * A view without a row (the one-view interlude after a melt) keeps the fold here until a second
   * view turns the region back into a stack.
   */
  collapsed?: boolean;
  /** Chrome the view's declarer set on it (tab dot, preview italic). */
  flags?: ViewFlags;
  /**
   * Whether this view is the one its region renders.
   *
   * **Separate from `order` on purpose**: `order` is the region's open order (the tab strip's
   * position, kept in sync with a stack's rows) and this is what "active" means (changed by
   * clicking a tab or by placing a view). VS Code keeps the two apart — its tabs do not
   * move when the active editor changes — and merging them made the strip MRU.
   */
  front?: boolean;
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

/**
 * Decoration a view's **declarer** can set on it, rendered in the region's chrome.
 *
 * The mechanism has no way to know this: whether a view has unsaved changes or is
 * a preview is the view's own fact, and the chrome that shows it (a tab's dot, an
 * italic label) is the frame's. So the declarer pushes flags and the frame renders
 * them — one direction, no second source of truth.
 */
export interface ViewFlags {
  /** Unsaved changes: the chrome shows a dot. */
  readonly dirty?: boolean;
  /** Preview: the label is italic, the way VS Code marks a preview tab. */
  readonly preview?: boolean;
  /**
   * Whether the view can be closed from its own chrome (a close button on its tab).
   *
   * The declarer's word, like the other flags: the mechanism renders the button and
   * reports the request through {@link PracLayoutFace.onDidRequestCloseView} — it never
   * closes anything itself, because what "closed" means belongs to whoever declared the
   * view (for a file, the app's open set).
   */
  readonly closable?: boolean;
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

/** Width/height of a sash's hit area in px (VS Code: `--vscode-sash-size` 4). Kept in step with FRAME_STYLES. */
export const SASH_SIZE = 4;
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
export const CENTER_REGION = "center";
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
   * The selected global central panel — the same source the `panelInfo` root hook reads.
   *
   * Upstream's `ILayout` carries it, and its plugins reach for it through `ctx.layout`
   * (measured: `@deepseek-ai/dsh-client-ui-sidebar-right` reads
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
  removeView(viewId: string): void;
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
   * Empty for a region that holds views; the arrangement uses this to keep the
   * children it does not own (prac's own views) when it rebuilds the containers.
   *
   * @param regionId - the region to inspect.
   */
  regionChildren(regionId: string): RegionChild[];
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
  /** Declare the height a view wants as a stack row; the layout only reads it. */
  setViewSize(viewId: string, size: number): void;
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
   * The source region keeps its size when it is fixed and its remaining views;
   * when it is flexible both regions share the split evenly.
   *
   * @param viewId - the view to move into the new region.
   * @param side - which side of its current region the new region goes on.
   */
  splitView(viewId: string, side: Side): void;
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
  setViewFlags(viewId: string, flags: ViewFlags): void;
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
  onDidRequestCloseView(listener: (viewId: string) => void): () => void;
  /**
   * The view the mechanism considers active: the front view of the centre region.
   *
   * A generic fact, not a view name — a UI that wants "bring the app in step with
   * what prac shows" reads this rather than re-deriving which region is the centre.
   *
   * @returns the view id, or null when the centre shows nothing.
   */
  activeView(): string | null;
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
