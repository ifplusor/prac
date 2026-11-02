/**
 * The arrangement's **placement policy** — the part that decides where items
 * go, with no React and no DOM.
 *
 * It lives apart from the plugin body (`index.ts`) for the same reason the
 * mechanism's arithmetic lives in `model.ts`: these are decisions a unit test
 * can make and a renderer merely carries out. The UI half (the focus strip, the
 * recall surface, the keybindings) imports the constants and the functions from
 * here and never restates a placement rule.
 *
 * @module prac-web-app/client/arrangement
 */

import type { ItemRecord } from "prac-ui-kit-frame";
import type { PracLayoutFace } from "prac-client-ui-frame/client";
import { DSH_CONVERSATION_VIEW, DSH_RIGHTBAR_VIEW, DSH_SIDEBAR_VIEW } from "prac-client-ui-dsh/lib";
import type { VscodeCatalogueEntry } from "prac-client-vscode-host/client";

/** The mechanism's placement face, named once for this module's signatures. */
export type PracLayout = PracLayoutFace;

export { DSH_CONVERSATION_VIEW, DSH_RIGHTBAR_VIEW, DSH_SIDEBAR_VIEW } from "prac-client-ui-dsh/lib";

/** The mechanism's default regions (`ui-frame`'s default region tree). */
export const LEFT = "left";
export const CENTER = "center";
export const RIGHT = "right";
export const BOTTOM = "bottom";

/**
 * The arrangement's default placement table — the single place that says what
 * prac starts with.
 *
 * `place` is "put it here and show it"; `hidden` entries are placed but not
 * shown (DSH's right panel is a view like any other and starts out of the way,
 * so the `right` region belongs to the editor).
 */
export const DEFAULT_PLACEMENTS: readonly {
  readonly view: string;
  readonly region: string;
  readonly hidden?: boolean;
}[] = [
  { view: DSH_SIDEBAR_VIEW, region: LEFT },
  { view: DSH_CONVERSATION_VIEW, region: CENTER },
  { view: DSH_RIGHTBAR_VIEW, region: RIGHT, hidden: true },
];
// No default for the centre's editor: since decision 17 a file is a view that
// exists because the *app* opened it, so there is nothing to place until one is
// open (see `trackCatalogue`).
// No default for the app's own items either: they are placed from the catalogue's
// own location (see `placeCatalogue`), which is the same table the app orders its
// containers by — restating them here would be a second source of truth.

/**
 * The app's location words, mapped to prac regions.
 *
 * The app's own vocabulary decides the default region, and this table is the one
 * place the two vocabularies meet: the mechanism reports the app's word, and the
 * frame knows only region ids.
 */
/** Human names for VS Code's built-in panel containers. */
const CONTAINER_LABELS: Readonly<Record<string, string>> = {
  "workbench.panel.markers": "Problems",
  "workbench.panel.output": "Output",
  "workbench.panel.repl": "Debug Console",
  terminal: "Terminal",
};

const containerLabel = (entry: VscodeCatalogueEntry): string =>
  (entry.containerId === undefined ? undefined : CONTAINER_LABELS[entry.containerId]) ??
  entry.containerTitle ??
  entry.title;

const LOCATION_REGION: Readonly<Record<VscodeCatalogueEntry["location"], string>> = {
  stage: CENTER,
  sidebar: LEFT,
  panel: BOTTOM,
  auxiliarybar: RIGHT,
};

/**
 * The app's items this arrangement leaves **off screen**.
 *
 * Named in the app's own vocabulary (`VscodeCatalogueEntry.appId`), so the policy
 * does not restate the mechanism's id convention. Both are real items prac
 * deliberately does not show at startup:
 *
 * - Copilot's chat — another agent's UI (kept installed, not surfaced);
 * - the debug **welcome** pane — a placeholder with no data provider, which reads
 *   as an empty box.
 *
 * They stay registered as `prac.view`s either way: the recall surface can bring
 * them up, which is what "off screen" means here.
 */
const EXCLUDED_VIEWS: ReadonlySet<string> = new Set([
  "workbench.panel.chat.view.copilot",
  "workbench.debug.welcome",
]);

/**
 * The key a catalogue entry's container child is named after.
 *
 * A borrowed view belongs to a container; a view that stands outside one gets a
 * child of its own — the shape VS Code reaches by generating a container.
 */
const entryKey = (entry: VscodeCatalogueEntry): string =>
  entry.containerId === undefined ? entry.view : `container:${entry.containerId}`;

/** The region id of one container child. */
const childRegionId = (region: string, key: string): string => `${region}/${key}`;

/** One container board target: the geometry node, its label and member items. */
export interface ContainerBoardTarget {
  readonly region: string;
  readonly label: string;
  readonly items: readonly string[];
}

/** The container boards the app catalogue implies. */
export function containerBoardTargets(
  entries: readonly VscodeCatalogueEntry[],
): readonly ContainerBoardTarget[] {
  const groups = new Map<string, { label: string; items: string[] }>();
  for (const entry of entries) {
    if (entry.source !== "view") continue;
    if (EXCLUDED_VIEWS.has(entry.appId)) continue;
    const region = childRegionId(LOCATION_REGION[entry.location], entryKey(entry));
    const bucket = groups.get(region) ?? { label: containerLabel(entry), items: [] };
    bucket.items.push(entry.view);
    groups.set(region, bucket);
  }
  return [...groups].map(([region, bucket]) => ({
    region,
    label: bucket.label,
    items: bucket.items,
  }));
}

/** The region id prefix that marks the children this function owns. */
const containerChildPrefix = (region: string): string => `${region}/container:`;

/** A view id's tail, as a child region's name. */
const viewLabel = (viewId: string): string =>
  (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");

/**
 * Place the app's items into **named container children**, by their own location, and
 * its **file placements** into the region the app reports.
 *
 * This is where a borrowed *container* becomes a prac shape: the region stops
 * holding items directly and instead **selects among** one child per container
 * (see `RegionChild`), so a location shows one container at a time the way an
 * activity bar would — without inheriting its chrome. prac's own items in the
 * same region get a child each and stay first in the bar, so the default screen
 * is unchanged and the borrowed containers are additions.
 *
 * Rebuilt whenever the catalogue changes: the catalogue is the truth about which
 * containers exist. A view's **placement** is not disturbed beyond landing in its
 * container, and the selector keeps whatever the person last chose.
 *
 * @param layout - the mechanism's placement face.
 * @param entries - the app's catalogue.
 */
/**
 * The heights VS Code's own Explorer starts its items at.
 *
 * The Explorer is a stack of sections there: **Open Editors** is a short list, the **file tree** takes
 * what is left, and **Outline** / **Timeline** start **folded** — headers you click to open. prac reads
 * these the way it reads every other declaration: the view says what it wants, the layout obeys.
 */
export const VIEW_DEFAULTS: Readonly<Record<string, { size?: number; folded?: boolean }>> = {
  "vscode:view:workbench.explorer.openEditorsView": { size: 120 },
  "vscode:view:outline": { folded: true },
  "vscode:view:timeline": { folded: true },
};

export function placeCatalogue(
  layout: PracLayout,
  entries: readonly VscodeCatalogueEntry[],
  placeContainerView?: (
    view: string,
    region: string,
    label: string,
    declared?: { readonly size?: number; readonly folded?: boolean },
  ) => boolean,
): void {
  const groups = new Map<string, Map<string, { label: string; items: string[] }>>();
  for (const entry of entries) {
    if (entry.source !== "view") continue;
    if (EXCLUDED_VIEWS.has(entry.appId)) continue;
    const region = LOCATION_REGION[entry.location];
    const byKey = groups.get(region) ?? new Map<string, { label: string; items: string[] }>();
    const key = entryKey(entry);
    const bucket = byKey.get(key) ?? { label: containerLabel(entry), items: [] };
    bucket.items.push(entry.view);
    byKey.set(key, bucket);
    groups.set(region, byKey);
  }
  for (const [region, byKey] of groups) {
    const children = new Map<string, { id: string; label?: string }>();
    for (const child of layout.regionChildren(region)) {
      // The DSH sidebar is hidden (the title bar owns session navigation), so it
      // must not stay the left selector's first/active child: that kept the
      // Explorer child selected-but-never-shown beside a 280px blank region.
      if (child.id === `${LEFT}/${DSH_SIDEBAR_VIEW}`) continue;
      if (!child.id.startsWith(containerChildPrefix(region))) children.set(child.id, child);
    }
    // Views still sitting directly in the region (placed before it became a
    // selector) move into a child of their own, ahead of the containers.
    for (const record of layout.listViews()) {
      if (record.region !== region) continue;
      children.set(childRegionId(region, record.id), {
        id: childRegionId(region, record.id),
        label: viewLabel(record.id),
      });
    }
    for (const [key, bucket] of byKey) {
      children.set(childRegionId(region, key), {
        id: childRegionId(region, key),
        label: bucket.label,
      });
    }
    layout.setRegionChildren(region, [...children.values()]);
    // Views still sitting directly in the region (placed before it became a
    // selector) move into a child of their own.
    for (const record of layout.listViews()) {
      if (record.region !== region) continue;
      layout.placeQuietly(record.id, childRegionId(region, record.id));
    }
    // Views the app newly offers go into their container — **filling gaps only**:
    // a view that already has a record keeps its placement (and its visibility),
    // so the catalogue can grow without undoing what the person did.
    const known = layout.getState().items;
    for (const [key, bucket] of byKey) {
      for (const view of bucket.items) {
        if (known[view] !== undefined) continue;
        const child = childRegionId(region, key);
        // What this view declares about its height — the layout only reads it (see `VIEW_DEFAULTS`).
        const declared = VIEW_DEFAULTS[view];
        // With a container-placement callback, the **container owns** the placement: `false`
        // means "the container is not materialized yet", and the catalogue sync retries. Falling
        // back to a frame record would put the widget in two places (double render).
        if (placeContainerView !== undefined) {
          placeContainerView(view, child, bucket.label, declared);
          continue;
        }
        layout.placeQuietly(view, child);
        if (declared?.size !== undefined) layout.setItemSize(view, declared.size);
        if (declared?.folded === true) layout.setItemCollapsed(view, true);
      }
    }
  }
  placeFileEntries(layout, entries);
}

/**
 * Place the app's **file placements**.
 *
 * A file view exists because the app has that file open in one of its editor groups,
 * and each placement is a view of its own — so one file can hold two items in two
 * regions, each showing its own surface. Two rules, in this order:
 *
 * - **the app's region wins** when it reports one: the group's home is where the file
 *   lives, and the arrangement follows it (quietly — placing is not fronting);
 * - otherwise the placement is one the app has not shown yet: the first placement of a
 *   file takes the centre, and a *second* placement of a file already on screen splits
 *   out beside it, which is what "split editor" means.
 *
 * A view that already has a record is left where it is: it may have been moved by the
 * person, and the catalogue is not more authoritative about placement than they are.
 * That is also what keeps a move from undoing itself — the app reports the region it
 * had *before* the move for as long as the frame takes to render the new one.
 *
 * @param layout - the mechanism's placement face.
 * @param entries - the app's catalogue.
 */
function placeFileEntries(layout: PracLayout, entries: readonly VscodeCatalogueEntry[]): void {
  const files = entries.filter((entry) => entry.source === "file");
  if (files.length === 0) return;
  /** Every placement of one resource, so a second one can find the first. */
  const siblings = new Map<string, string[]>();
  for (const entry of files) {
    siblings.set(entry.appId, [...(siblings.get(entry.appId) ?? []), entry.view]);
  }
  for (const entry of files) {
    const known = layout.getState().items;
    if (known[entry.view] !== undefined) continue;
    const shown = (siblings.get(entry.appId) ?? [])
      .filter((view) => view !== entry.view)
      .map((view) => known[view])
      .find((record) => record !== undefined && record.region !== null && !record.hidden);
    if (entry.region !== null && entry.region !== undefined) {
      layout.placeQuietly(entry.view, entry.region);
    } else if (shown?.region !== undefined) {
      // The same file already holds a region: this placement is the app showing it a
      // second time, so it goes beside that one rather than on top of it.
      layout.placeQuietly(entry.view, shown.region);
      layout.splitView(entry.view, "right");
    } else {
      layout.placeQuietly(entry.view, CENTER);
    }
  }
}

/**
 * The roles DSH's borrowed `ctx.layout` vocabulary resolves through. The
 * mechanism names no view; this table is what makes `toggleSidebar()` mean
 * "collapse the region holding `dsh:sidebar`".
 */
export const ROLES = {
  primarySidebar: DSH_SIDEBAR_VIEW,
  secondarySidebar: DSH_RIGHTBAR_VIEW,
} as const;

/**
 * Put a newly opened file in the centre.
 *
 * The file is a window in the centre window group; the conversation stays there
 * as another tab, so the window group's tab strip owns the switch.
 *
 * @param layout - the mechanism's placement face.
 * @param view - the file view the app just opened.
 */
export function openFileInto(layout: PracLayout, view: string): void {
  layout.place(view, CENTER);
  layout.show(view);
}

/**
 * The file items the frame should stop showing.
 *
 * A file view exists because the **app** has that file open. When it no longer does — a
 * closed editor, or a page reload whose app state is gone — the view has no subject left.
 *
 * What the caller does with them is **forget**, not hide: a hidden view is one the person
 * put away and can bring back, while this one has nothing to come back to. A remembered
 * record is also actively in the way — a placement is named by the host, the next open of
 * the same file mints a fresh name, and a record left under it would keep the new
 * placement from being shown.
 *
 * @param records - the frame's view table.
 * @param openFiles - the file items the app currently reports.
 * @param resourceOf - the host's file-view test (`undefined` for anything else).
 * @returns the file items with no subject left.
 */
export function staleFileViews(
  records: Readonly<Record<string, ItemRecord>>,
  openFiles: ReadonlySet<string>,
  resourceOf: (view: string) => string | undefined,
): string[] {
  return Object.keys(records).filter(
    (view) => resourceOf(view) !== undefined && !openFiles.has(view),
  );
}

/**
 * Give the centre back to the conversation when nothing else holds it.
 *
 * The arrangement's own default says the conversation lives in the centre; this
 * is that default re-applied to a *gap* rather than to a fresh frame — which is
 * what happens when the last file closes and takes the editor surface with it.
 *
 * @param layout - the mechanism's placement face.
 * @returns whether the conversation had to be moved.
 */
export function restoreCentre(layout: PracLayout): boolean {
  if (layout.getState().items[DSH_CONVERSATION_VIEW]?.region === CENTER) return false;
  layout.place(DSH_CONVERSATION_VIEW, CENTER);
  return true;
}

/**
 * Lay out prac's default arrangement and bind the roles the compat shim uses.
 *
 * The defaults **fill gaps instead of re-asserting themselves**: the frame's
 * state is persisted per origin, so on the next load most of these items already
 * have a placement, and re-placing them would silently drag the arrangement back
 * to its factory shape — `place(conversation, 'bottom')` would survive until the
 * next reload and then undo itself. A view with no record (a fresh window, or a
 * view this table just gained) still gets its default.
 *
 * @param layout - the mechanism's placement face.
 */
export function arrange(layout: PracLayout): void {
  layout.bindRoles(ROLES);
  // Where a view parks when it gives up the centre: the right track, which is
  // what the arrangement already uses for the window group it is *not* on.
  layout.bindTrack(RIGHT);
  // The left rail is the dock's activity bar, drawn **outside** the region: the region itself has no
  // in-region selector strip, so the allocation must not reserve one. The bottom dock is hidden, so
  // it has no selector either. Both are state, not CSS: a hidden strip still costs its height.
  layout.setRegionSelector(LEFT, "rail");
  layout.setRegionSelector(RIGHT, "rail");
  layout.setRegionSelector(BOTTOM, "title");
  const known = layout.getState().items;
  for (const entry of DEFAULT_PLACEMENTS) {
    if (known[entry.view] !== undefined) continue;
    layout.place(entry.view, entry.region);
    if (entry.hidden === true) layout.hide(entry.view);
  }
  // The title bar owns session/workspace selection; the DSH sidebar remains
  // registered (the recall surface can still reach it) but starts hidden.
  layout.hide(DSH_SIDEBAR_VIEW);
  // The left region's content is the container **board window** the catalogue sync creates;
  // placing a bare Explorer view here would be a second, empty home for the same container.
}
