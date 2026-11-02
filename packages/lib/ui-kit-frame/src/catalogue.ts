/**
 * The view/region shapes shared by the frame and its consumers.
 *
 * The kit knows prac's own slot keys (the ids its surfaces declare) and the
 * shape of a view/region offering. It does **not** know DSH's slot vocabulary or
 * read DSH's registry — that lives in the frame plugin.
 *
 * @module prac-ui-kit-frame/catalogue
 */

/**
 * The slot prac's own views register into: a `root`-scoped list slot declared
 * by the frame. An entry's view id is what it declares (`vscode:view:<app view id>`).
 */
export const VIEW_SLOT = "prac.view";
/** Window content: file / chat / board window content. */
export const WINDOW_SLOT = "prac.window";
/** Widget content: VS Code view / DSH widget content. */
export const WIDGET_SLOT = "prac.widget";

/**
 * The source segment of a view id (`<source>:`); `""` when there is none.
 *
 * @param viewId - the view identity.
 */
export function viewSource(viewId: string): string {
  const colon = viewId.indexOf(":");
  return colon === -1 ? "" : viewId.slice(0, colon + 1);
}

/**
 * One view the frame knows about, together with where it currently sits.
 *
 * This is what lets a UI offer the views that are *not* on screen, not just the
 * ones already placed: `region: null` means nothing has placed it yet, and
 * `order` is only meaningful once a region holds it.
 */
export interface ViewInfo {
  /** The view identity (whatever the source declares). */
  readonly id: string;
  /** The region currently holding the view, or null while it is unplaced. */
  readonly region: string | null;
  /** Whether the view is currently not shown. Unplaced views count as hidden. */
  readonly hidden: boolean;
  /** The view's order inside its region (lower renders first), or null. */
  readonly order: number | null;
  /** Whether this frame view is a window or a widget. */
  readonly kind: "window" | "widget";
}

/** A `ViewInfo` proven to be a window. */
export interface WindowInfo extends ViewInfo {
  readonly kind: "window";
}

/** A `ViewInfo` proven to be a widget. */
export interface WidgetInfo extends ViewInfo {
  readonly kind: "widget";
}

/** The classified view-info union. */
export type TypedViewInfo = WindowInfo | WidgetInfo;

export function isWindowInfo(view: ViewInfo): view is WindowInfo {
  return view.kind === "window";
}

export function isWidgetInfo(view: ViewInfo): view is WidgetInfo {
  return view.kind === "widget";
}

/**
 * One region a view can be moved to.
 *
 * The id is what `place` takes; `collapsed` is included because a UI that
 * offers "move to …" and "collapse/expand" needs both without walking the tree.
 */
export interface RegionInfo {
  /** The region id. */
  readonly id: string;
  /** Whether the region currently renders at 0px. */
  readonly collapsed: boolean;
}
