/**
 * The view catalogue: which view ids exist, and where they were declared.
 *
 * A view id is `<source>:<name>`. The **place** it renders in comes from the
 * `views` table (filled by the arrangement), and **what** renders it comes from
 * where it was declared: DSH's own slots, or the `prac.view` slot. That is decided
 * by registry membership, never by the id's source name — the frame must not know
 * which producer chose `vscode:`.
 *
 * @module prac-client-ui-layout/client/catalogue
 */

import type { Context } from "@deepseek-ai/cordis";

// ── view catalogue ────────────────────────────────────────────────────
//
// A view id is `<source>:<name>`. The **place** it renders in comes from the
// `views` table (filled by the arrangement), and **what** renders it comes from
// where it was declared: DSH's own slots, or the `prac.view` slot. That is
// decided by registry membership, never by the id's source name — the frame must
// not know which producer chose `vscode:`.

/** The `dsh:` source: a slot DSH's own plugins register into. */
export const DSH_VIEW_SOURCE = "dsh:";
/**
 * DSH's `sidebar` slot as a view id. The mechanism renders the slot; the
 * arrangement decides which region it occupies.
 */
export const DSH_SIDEBAR_VIEW = "dsh:sidebar";
/** DSH's `rightbar` slot as a view id (see {@link DSH_SIDEBAR_VIEW}). */
export const DSH_RIGHTBAR_VIEW = "dsh:rightbar";
/** Prefix of DSH's keyed `main` slot ids (`dsh:main:<key>`). */
export const DSH_MAIN_PREFIX = "dsh:main:";
/** DSH's main-slot key for the current conversation (`selectPanel(null)`). */
export const DSH_CONVERSATION_KEY = "conversation";
/**
 * The slot prac's own views register into: a `root`-scoped list slot declared
 * by this frame. An entry's view id is what it declares (`vscode:view:<app view id>`).
 */
export const VIEW_SLOT = "prac.view";

/**
 * The source segment of a view id (`dsh:`, `vscode:`, …); `""` when there is none.
 *
 * @param viewId - the view identity.
 */
export function viewSource(viewId: string): string {
  const colon = viewId.indexOf(":");
  return colon === -1 ? "" : viewId.slice(0, colon + 1);
}

/**
 * The view ids the `prac.view` slot currently declares.
 *
 * Membership in the slot's registry **is** what makes a view one this frame renders: the
 * frame then renders the slot's own declaration for it (see {@link View}). A name
 * prefix would not do — the mechanism owns neither the slot's id vocabulary nor
 * the producers that use it.
 *
 * Refreshed wherever the catalogue is re-read or a view registration changes, so
 * a source that starts declaring a view is picked up without the frame knowing
 * who it is.
 */
let declaredViewIds: ReadonlySet<string> = new Set<string>();
/** The display title each `prac.view` entry declares, keyed by view id. */
let declaredViewLabels: ReadonlyMap<string, string> = new Map<string, string>();
/** The icon class each `prac.view` entry declares, keyed by view id. */
let declaredViewIcons: ReadonlyMap<string, string> = new Map<string, string>();
/**
 * Which declared views bring a **native pane header**.
 *
 * A pane header is the view's own title bar (VS Code's `ViewPane` draws one). The
 * frame still owns the row's title, fold and drag, but it draws them as an overlay
 * over that header instead of as a separate row header, and hides the native
 * title so the two do not compete. Whether a view has one is the **view's** fact,
 * not its source's: the frame must not infer it from a `vscode:` prefix.
 */
let declaredViewPaneHeaders: ReadonlySet<string> = new Set<string>();

/**
 * Re-read the `prac.view` slot registry into {@link declaredViewIds}.
 *
 * @param slots - the slot registry face the frame holds.
 * @returns the slot's current view ids.
 */
export function readDeclaredViewIds(slots: Context["slots"]): ReadonlySet<string> {
  const ids = new Set<string>();
  const labels = new Map<string, string>();
  const icons = new Map<string, string>();
  const paneHeaders = new Set<string>();
  for (const entry of slots.entries(VIEW_SLOT)) {
    const id = entry.options.id;
    if (id === undefined || id === "") continue;
    ids.add(id);
    const label = entry.options.label;
    if (typeof label === "string" && label !== "") labels.set(id, label);
    const options = entry.options as { icon?: unknown; paneHeader?: unknown };
    if (typeof options.icon === "string" && options.icon !== "") icons.set(id, options.icon);
    if (options.paneHeader === true) paneHeaders.add(id);
  }
  declaredViewIds = ids;
  declaredViewLabels = labels;
  declaredViewIcons = icons;
  declaredViewPaneHeaders = paneHeaders;
  return ids;
}

/**
 * The display title a `prac.view` entry declared, if any.
 *
 * The frame must not show the raw id when the source already has a title: the
 * VS Code catalogue reports `title` and `ui-vscode-views` carries it here.
 *
 * @param viewId - the view identity.
 * @returns the declared label, or undefined for DSH slots/unknown ids.
 */
export function declaredViewLabel(viewId: string): string | undefined {
  return declaredViewLabels.get(viewId);
}

/**
 * The icon class a `prac.view` entry declared, if any.
 *
 * The value is an opaque class name the declaring adapter owns (VS Code passes
 * its codicon class; another adapter may pass its own). The frame only renders
 * it, never interprets it.
 *
 * @param viewId - the view identity.
 * @returns the declared icon class, or undefined.
 */
export function declaredViewIcon(viewId: string): string | undefined {
  return declaredViewIcons.get(viewId);
}

/**
 * Whether a declared view brings a native pane header of its own.
 *
 * The fact is declared through the `prac.view` entry (`paneHeader: true`), never
 * inferred from the view id's source segment. A stack row for such a view keeps
 * the view's header and draws the frame's fold/drag control as an overlay; a row
 * for any other view is the frame's own header.
 *
 * @param viewId - the view identity.
 * @returns whether the view declares a pane header.
 */
export function declaredViewPaneHeader(viewId: string): boolean {
  return declaredViewPaneHeaders.has(viewId);
}

/**
 * How the frame should render a view id.
 *
 * **Membership wins over the id's source segment**: a `prac.view` declaration is
 * authoritative even when its id starts with `dsh:` (a producer owns its ids, so
 * a prefix is not a dispatch rule). `dsh:` is only the fallback for DSH's own
 * slots, which are not declared into `prac.view`.
 */
export type ViewKind = "declared" | "dsh" | "unknown";

/**
 * Classify a view id for rendering.
 *
 * @param viewId - the view identity.
 * @returns `"declared"` for a `prac.view` entry, `"dsh"` for one of DSH's own
 *   slots, `"unknown"` otherwise.
 */
export function viewKind(viewId: string): ViewKind {
  if (isDeclaredView(viewId)) return "declared";
  return viewSource(viewId) === DSH_VIEW_SOURCE ? "dsh" : "unknown";
}

/**
 * Whether a view id is declared by the `prac.view` slot (rather than being one of
 * DSH's own slots).
 *
 * @param viewId - the view identity.
 */
export function isDeclaredView(viewId: string): boolean {
  return declaredViewIds.has(viewId);
}

/**
 * One view the frame knows about, together with where it currently sits.
 *
 * This is what lets a UI offer the views that are *not* on screen, not just the
 * ones already placed: `region: null` means nothing has placed it yet, and
 * `order` is only meaningful once a region holds it.
 */
export interface ViewInfo {
  /** The view identity (`dsh:*`, `prac:*`, `vscode:*`). */
  readonly id: string;
  /** The region currently holding the view, or null while it is unplaced. */
  readonly region: string | null;
  /** Whether the view is currently not shown. Unplaced views count as hidden. */
  readonly hidden: boolean;
  /** The view's order inside its region (lower renders first), or null. */
  readonly order: number | null;
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

/**
 * The view ids the frame can currently offer, in a deterministic order.
 *
 * The catalogue is the union of two live sources, never a hard-coded list:
 *
 * - DSH's own slots — `sidebar`, `rightbar`, and one id per **currently
 *   registered** `main` key. Keys are read through the slot registry on every
 *   call, so a plugin that registers a panel later is picked up.
 * - Every entry of the `prac.view` slot (a `vscode:` part host or a `prac:` view),
 *   whose declared entry id *is* its view id.
 *
 * Sorting each group keeps the offered order stable across re-reads while
 * registrations come and go.
 *
 * @param slots - the slot registry face the frame holds.
 */
export function catalogueViewIds(slots: Context["slots"]): string[] {
  const mainKeys = new Set<string>();
  for (const entry of slots.entries("main")) {
    if (entry.options.key !== undefined) mainKeys.add(entry.options.key);
  }
  const declaredIds = readDeclaredViewIds(slots);
  return [
    DSH_SIDEBAR_VIEW,
    ...[...mainKeys].sort().map((key) => `${DSH_MAIN_PREFIX}${key}`),
    DSH_RIGHTBAR_VIEW,
    ...[...declaredIds].sort(),
  ];
}
