/**
 * The arrangement's **placement policy** — the part that decides where views
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

import type { PracLayoutFace, ViewRecord } from "prac-client-ui-layout/client";
import type { VscodeCatalogueEntry } from "prac-client-vscode-host/client";

/** The mechanism's placement face, named once for this module's signatures. */
export type PracLayout = PracLayoutFace;

/** DSH's sidebar slot as a view id (see `prac-client-ui-layout`'s catalogue). */
export const DSH_SIDEBAR_VIEW = "dsh:sidebar";
/** DSH's rightbar slot as a view id. */
export const DSH_RIGHTBAR_VIEW = "dsh:rightbar";
/** DSH's keyed `main` slot: the conversation is its default key. */
export const DSH_CONVERSATION_VIEW = "dsh:main:conversation";

/** The mechanism's default regions (`prac-client-ui-layout`'s default region tree). */
export const LEFT = "left";
export const CENTER = "center";
export const RIGHT = "right";
export const BOTTOM = "bottom";

/** The surfaces attention can rest on. */
export const CONVERSATION = "conversation";
export const VSCODE_SURFACE = "vscode";

/** One of attention's surfaces. */
export type Surface = typeof CONVERSATION | typeof VSCODE_SURFACE;

/**
 * The region a view is brought forward into. The centre is the work area; the
 * mechanism's `stage` region stays a valid target even after it has been split.
 */
export const FOCUS_VIEW_REGION = CENTER;

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
// No default for the app's own views either: they are placed from the catalogue's
// own location (see `placeCatalogue`), which is the same table the app orders its
// containers by — restating them here would be a second source of truth.

/**
 * The app's location words, mapped to prac regions.
 *
 * The app's own vocabulary decides the default region, and this table is the one
 * place the two vocabularies meet: the mechanism reports the app's word, and the
 * frame knows only region ids.
 */
const LOCATION_REGION: Readonly<Record<VscodeCatalogueEntry["location"], string>> = {
  stage: CENTER,
  sidebar: LEFT,
  panel: BOTTOM,
  auxiliarybar: RIGHT,
};

/**
 * The app's views this arrangement leaves **off screen**.
 *
 * Named in the app's own vocabulary (`VscodeCatalogueEntry.appId`), so the policy
 * does not restate the mechanism's id convention. Both are real views prac
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

/** The region id prefix that marks the children this function owns. */
const containerChildPrefix = (region: string): string => `${region}/container:`;

/** A view id's tail, as a child region's name. */
const viewLabel = (viewId: string): string =>
  (viewId.split(":").pop() ?? viewId).replace(/[-_]/g, " ");

/**
 * Place the app's views into **named container children**, by their own location, and
 * its **file placements** into the region the app reports.
 *
 * This is where a borrowed *container* becomes a prac shape: the region stops
 * holding views directly and instead **selects among** one child per container
 * (see `RegionChild`), so a location shows one container at a time the way an
 * activity bar would — without inheriting its chrome. prac's own views in the
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
export function placeCatalogue(layout: PracLayout, entries: readonly VscodeCatalogueEntry[]): void {
  const groups = new Map<string, Map<string, { label: string; views: string[] }>>();
  for (const entry of entries) {
    if (entry.source !== "view") continue;
    if (EXCLUDED_VIEWS.has(entry.appId)) continue;
    const region = LOCATION_REGION[entry.location];
    const byKey = groups.get(region) ?? new Map<string, { label: string; views: string[] }>();
    const key = entryKey(entry);
    const bucket = byKey.get(key) ?? { label: entry.containerTitle ?? entry.title, views: [] };
    bucket.views.push(entry.view);
    byKey.set(key, bucket);
    groups.set(region, byKey);
  }
  for (const [region, byKey] of groups) {
    const children = new Map<string, { id: string; label?: string }>();
    for (const child of layout.regionChildren(region)) {
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
    const known = layout.getState().views;
    for (const [key, bucket] of byKey) {
      for (const view of bucket.views) {
        if (known[view] !== undefined) continue;
        layout.placeQuietly(view, childRegionId(region, key));
      }
    }
  }
  placeFileEntries(layout, entries);
}

/**
 * Place the app's **file placements**.
 *
 * A file view exists because the app has that file open in one of its editor groups,
 * and each placement is a view of its own — so one file can hold two views in two
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
    const known = layout.getState().views;
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
 * Put attention's surfaces in regions.
 *
 * The focused surface takes the centre and the other parks in the right track,
 * so both stay on screen. The conversation is a view like any other here: when
 * the editor is focused the chat is still visible beside it, and vice versa.
 *
 * @param layout - the mechanism's placement face.
 * @param surface - the surface attention is on.
 */
export function placeSurfaces(layout: PracLayout, surface: Surface, fileView: string | null): void {
  layout.place(DSH_CONVERSATION_VIEW, surface === CONVERSATION ? CENTER : RIGHT);
  if (fileView !== null) layout.place(fileView, surface === VSCODE_SURFACE ? CENTER : RIGHT);
}

/**
 * Bring one view to the centre, parking the conversation in the track unless it
 * *is* the conversation.
 *
 * The recall surface's own door onto the same rule `selectPanel` applies: one
 * view holds a region, and the one that gives it up stays on screen in the
 * track rather than disappearing behind the new front.
 *
 * @param layout - the mechanism's placement face.
 * @param viewId - the view to bring forward.
 */
export function focusView(layout: PracLayout, viewId: string): void {
  if (viewId !== DSH_CONVERSATION_VIEW) layout.place(DSH_CONVERSATION_VIEW, RIGHT);
  layout.place(viewId, FOCUS_VIEW_REGION);
}

/**
 * Put a newly opened file in the centre, keeping the conversation on screen.
 *
 * The arrangement's answer to "a file opened in the app" (decision 17): the file
 * takes the centre and the conversation parks in the track, which is the same
 * rule attention uses — one view holds a region, the one that yields stays
 * visible beside it.
 *
 * @param layout - the mechanism's placement face.
 * @param view - the file view the app just opened.
 */
export function openFileInto(layout: PracLayout, view: string): void {
  layout.place(DSH_CONVERSATION_VIEW, RIGHT);
  layout.place(view, FOCUS_VIEW_REGION);
}

/**
 * The file views the frame should stop showing.
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
 * @param openFiles - the file views the app currently reports.
 * @param resourceOf - the host's file-view test (`undefined` for anything else).
 * @returns the file views with no subject left.
 */
export function staleFileViews(
  records: Readonly<Record<string, ViewRecord>>,
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
  if (layout.getState().views[DSH_CONVERSATION_VIEW]?.region === FOCUS_VIEW_REGION) return false;
  layout.place(DSH_CONVERSATION_VIEW, FOCUS_VIEW_REGION);
  return true;
}

/**
 * Lay out prac's default arrangement and bind the roles the compat shim uses.
 *
 * The defaults **fill gaps instead of re-asserting themselves**: the frame's
 * state is persisted per origin, so on the next load most of these views already
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
  // what the arrangement already uses for the surface attention is *not* on.
  layout.bindTrack(RIGHT);
  const known = layout.getState().views;
  for (const entry of DEFAULT_PLACEMENTS) {
    if (known[entry.view] !== undefined) continue;
    layout.place(entry.view, entry.region);
    if (entry.hidden === true) layout.hide(entry.view);
  }
}
