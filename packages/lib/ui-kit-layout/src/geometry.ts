/**
 * Layout geometry vocabulary shared by the solver and surface binding.
 *
 * The geometry tree is independent of the object graph. It is generic UI
 * vocabulary: no DSH, React, DOM or prac-specific window model.
 *
 * @module prac-ui-kit-layout/geometry
 */

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
   * How the region presents its **choice among its children**.
   *
   * `"rail"` is the dock rail (an activity bar drawn **outside** the region, by the shell), so the
   * region reserves no strip of its own; `"title"` is a strip **inside** the region's top edge (the
   * frame draws it, and the allocation reserves its height); `"none"` draws no selector even when
   * there are several children (the caller switches them, or only one is meant to be reachable).
   *
   * Absent keeps the pre-dock behaviour: a strip whenever the region has more than one child. The
   * kind is **state, not CSS** — a shell that hides a selector with `display:none` still leaves the
   * allocation reserving its height, which is what `"rail"` exists to say explicitly.
   */
  readonly selector?: RegionSelector;
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

/** How a region presents its choice among its children (see {@link RegionNode.selector}). */
export type RegionSelector = "rail" | "title" | "none";

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

/**
 * A two-dimensional grid of child regions.
 *
 * The grid is topology, not sizing: cells are ordinary regions (or splits),
 * laid out row-major. The first slice gives every cell one row and one column.
 */
/** Where one grid child sits; spans default to one row/column. */
export interface GridPlacement {
  readonly row: number;
  readonly column: number;
  readonly rowSpan?: number;
  readonly columnSpan?: number;
}

export interface GridNode {
  readonly type: "grid";
  readonly id: string;
  readonly rows: number;
  readonly columns: number;
  /** Relative widths of the declared columns; absent means equal. */
  readonly columnWeights?: readonly number[];
  /** Relative heights of the declared rows; absent means equal. */
  readonly rowWeights?: readonly number[];
  /** Explicit placements by child id; absent means row-major. */
  readonly placements?: Readonly<Record<string, GridPlacement>>;
  /**
   * The placements a merged cell was made from, keyed by the merged split id.
   * Kept so unmerge can restore unequal spans instead of dividing evenly.
   */
  readonly merged?: Readonly<
    Record<string, { readonly source: GridPlacement; readonly target: GridPlacement }>
  >;
  /** Common placement fields, so a grid can sit where a split can. */
  readonly size?: number;
  readonly flex?: boolean;
  readonly max?: number;
  readonly priority?: LayoutPriority;
  readonly label?: string;
  readonly collapsed?: boolean;
  readonly active?: string;
  readonly min?: number;
  readonly stack?: boolean;
  readonly entry?: boolean;
  readonly children: readonly LayoutNode[];
}

/** One node of the region tree. */
export type LayoutNode = RegionNode | SplitNode | GridNode;

/** A resolved region box for one viewport. */
export interface Box {
  width: number;
  height: number;
}

/** Alias used by the binding layer. */
export type GeometryNode = LayoutNode;

/** Split axis, named after the layout concept rather than a UI framework. */
export type Axis = Dir;
