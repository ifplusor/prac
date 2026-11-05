/**
 * The DSH side of the view catalogue.
 *
 * Which view ids DSH's own slots declare, which entries the content slots
 * (`prac.window` / `prac.widget`) hold, and the DSH id vocabulary
 * (`dsh:sidebar`, `dsh:main:<key>`, `dsh:rightbar`). This lives in the plugin:
 * `prac-ui-kit-workbench` only owns the view/region shapes and prac's own slot
 * keys.
 *
 * @module prac-client-ui-frame/client/catalogue
 */

import type { ReactNode } from "react";

/** Window content slot. */
export const WINDOW_SLOT = "prac.window";
/** Widget content slot. */
export const WIDGET_SLOT = "prac.widget";

/** The source segment of a view id (`<source>:`); `""` when there is none. */
export function viewSource(viewId: string): string {
  const colon = viewId.indexOf(":");
  return colon === -1 ? "" : viewId.slice(0, colon + 1);
}

/**
 * The slice of DSH's slot registry the catalogue reads.
 *
 * Structural on purpose: the plugin must not pull the renderer's service types
 * (and their module augmentations) into its declaration file. `ctx.slots`
 * satisfies it because its `entries` accepts a superset of these keys.
 */
export interface CatalogueSlots {
  entries(slot: "main" | "prac.window" | "prac.widget"): Iterable<{
    readonly options: {
      readonly id?: string;
      readonly key?: string;
      readonly label?: unknown;
      readonly icon?: unknown;
      readonly paneHeader?: unknown;
    };
  }>;
}

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
 * The view ids the content slots currently declare.
 *
 * Membership in the slot's registry **is** what makes a view one this frame
 * renders: a name prefix would not do — the mechanism owns neither the slot's
 * id vocabulary nor the producers that use it. Refreshed wherever the catalogue
 * is re-read or a view registration changes.
 */
let declaredViewIds: ReadonlySet<string> = new Set<string>();
/** The content slot each declared view registered into. */
let declaredViewSlots: ReadonlyMap<string, "window" | "widget"> = new Map();
/** The display title each content-slot entry declares, keyed by view id. */
let declaredViewLabels: ReadonlyMap<string, string> = new Map<string, string>();
/** The icon class each content-slot entry declares, keyed by view id. */
let declaredViewIcons: ReadonlyMap<string, string> = new Map<string, string>();
/** Which declared items bring a native pane header. */
let declaredViewPaneHeaders: ReadonlySet<string> = new Set<string>();
let declaredViewActions: ReadonlyMap<string, () => ReactNode> = new Map<string, () => ReactNode>();

/**
 * Re-read the slot registries into {@link declaredViewIds}.
 *
 * @param slots - the slot registry face the frame holds.
 * @returns the slot's current view ids.
 */
export function readDeclaredViewIds(slots: CatalogueSlots): ReadonlySet<string> {
  const ids = new Set<string>();
  const labels = new Map<string, string>();
  const icons = new Map<string, string>();
  const paneHeaders = new Set<string>();
  const actionsById = new Map<string, () => ReactNode>();
  const slotsById = new Map<string, "window" | "widget">();
  for (const [slot, kind] of [
    [WINDOW_SLOT, "window"],
    [WIDGET_SLOT, "widget"],
  ] as const) {
    for (const entry of slots.entries(slot)) {
      const id = entry.options.id;
      if (id === undefined || id === "") continue;
      ids.add(id);
      slotsById.set(id, kind);
      const label = entry.options.label;
      if (typeof label === "string" && label !== "") labels.set(id, label);
      const options = entry.options as {
        icon?: unknown;
        paneHeader?: unknown;
        actions?: unknown;
      };
      if (typeof options.icon === "string" && options.icon !== "") icons.set(id, options.icon);
      if (options.paneHeader === true) paneHeaders.add(id);
      if (typeof options.actions === "function") {
        actionsById.set(id, options.actions as () => ReactNode);
      }
    }
  }
  declaredViewIds = ids;
  declaredViewSlots = slotsById;
  declaredViewLabels = labels;
  declaredViewIcons = icons;
  declaredViewPaneHeaders = paneHeaders;
  declaredViewActions = actionsById;
  return ids;
}

/** The content slot a declared view registered into. */
export function declaredViewSlot(viewId: string): "window" | "widget" | undefined {
  return declaredViewSlots.get(viewId);
}

/** The display title a content-slot entry declared, if any. */
export function declaredViewLabel(viewId: string): string | undefined {
  return declaredViewLabels.get(viewId);
}

/** The icon class a content-slot entry declared, if any. */
export function declaredViewIcon(viewId: string): string | undefined {
  return declaredViewIcons.get(viewId);
}

/** The actions a content-slot entry declared for its view, if any. */
export function declaredViewActionsFor(viewId: string): (() => ReactNode) | undefined {
  return declaredViewActions.get(viewId);
}

/** Whether a declared view brings a native pane header of its own. */
export function declaredViewPaneHeader(viewId: string): boolean {
  return declaredViewPaneHeaders.has(viewId);
}

/**
 * How the frame should render a view id.
 *
 * **Membership wins over the id's source segment**: a declaration in a content
 * slot is authoritative even when its id starts with `dsh:` (a producer owns its
 * ids, so a prefix is not a dispatch rule). `dsh:` is only the fallback for
 * DSH's own slots, which are not declared into `prac.window` / `prac.widget`.
 */
export type ViewKind = "declared" | "dsh" | "unknown";

/**
 * Classify a view id for rendering.
 *
 * @param viewId - the view identity.
 * @returns `"declared"` for a content-slot entry, `"dsh"` for one of DSH's own
 *   slots, `"unknown"` otherwise.
 */
export function viewKind(viewId: string): ViewKind {
  if (isDeclaredView(viewId)) return "declared";
  return viewSource(viewId) === DSH_VIEW_SOURCE ? "dsh" : "unknown";
}

/**
 * Whether a view id is declared by a content slot (rather than being one of
 * DSH's own slots).
 *
 * @param viewId - the view identity.
 */
export function isDeclaredView(viewId: string): boolean {
  return declaredViewIds.has(viewId);
}

/**
 * The view ids the frame can currently offer, in a deterministic order.
 *
 * The catalogue is the union of two live sources, never a hard-coded list:
 * DSH's own slots (`sidebar`, `rightbar`, and one id per currently registered
 * `main` key) and every entry of the content slots. Sorting each group keeps
 * the offered order stable across re-reads.
 *
 * @param slots - the slot registry face the frame holds.
 */
export function catalogueViewIds(slots: CatalogueSlots): string[] {
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
