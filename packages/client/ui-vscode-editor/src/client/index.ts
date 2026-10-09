/**
 * prac-client-ui-vscode-editor — the editor package.
 *
 * Declares **one `prac.view` entry per open file** (decision 17): the app
 * contributes a file's editing surface, and this package turns the app's open-file
 * set into views. Which files are open comes from the app's own editor service
 * (an explorer click, a command, a go-to-definition); the mechanism publishes
 * that as the catalogue's `source: "file"` entries, and this package takes those —
 * the view id is `vscode:file:<resource>`, and the mapping between id and
 * resource belongs to `prac-client-vscode-host`.
 *
 * The mechanism arrives as an injected **service** (`ctx.pracVscode`) rather than
 * as an import, because each client plugin is bundled and inlined on its own: an
 * imported module would duplicate the singleton boot guard. Injecting it is what
 * lets the view consumers be separate bundles, each placeable, showable, or disabled on
 * its own.
 *
 * Placement is not decided here. The arrangement (`prac-web-app`) puts a newly
 * opened file in the centre; the mechanism renders it in whatever region that is
 * and owns the tab strip over several files. What the mechanism cannot know — the
 * app's unsaved/preview state, and which file the app has active — this package reads
 * from the `editors` capability and pushes (chrome flags, and `activate` when
 * prac's front view moves).
 *
 * @module prac-client-ui-vscode-editor/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { PracVscodeFace, VscodeCatalogueEntry } from "prac-client-vscode-host/client";
import type { PracLayoutFace, ViewSlotKey } from "prac-client-ui-layout/client";

/** The slot these views are registered into (checked against the mechanism's key). */
const SLOT: ViewSlotKey = "prac.view";

/**
 * Declare one view entry per open file, and keep that set in sync with the app.
 *
 * The slot is declared by `prac-client-ui-layout`'s frame, so injecting waits for
 * that declaration (either client plugin may activate first). Each entry is a
 * registration of its own — the mechanism's view catalogue reads the registry, so
 * a file appearing or closing is exactly a registration appearing or going away.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The mechanism comes from the service registry; naming its published face here
  // is what keeps this slot's use of it checked.
  const host: PracVscodeFace = ctx.pracVscode;
  const slots: SlotRegistry = ctx.slots;
  const layout: PracLayoutFace = ctx.pracLayout;
  /** The catalogue entries this package declares views for: the open files. */
  const fileEntries = (): readonly VscodeCatalogueEntry[] =>
    host.catalogue().filter((entry) => entry.source === "file");
  // The app's own state, read through the capability: the tab's dot, its preview
  // italic, and which file the app has active. This package owns this because the
  // views are its own — the mechanism renders what it is told and knows nothing
  // about files.
  ctx.effect(() => {
    const editors = host.capabilities.editors;
    /**
     * The file resources prac currently shows: the front view of **every** region.
     *
     * A region renders its front view, so this is "the files on screen" — the fact the
     * reconciliation below needs, because prac can show two files at once (one per
     * region) and only one of them can be the app's active editor.
     */
    const shownFiles = (): Set<string> => {
      const front = new Map<string, { order: number; view: string }>();
      for (const entry of layout.listViews()) {
        if (entry.region === null || entry.hidden) continue;
        const order = entry.order ?? Number.MAX_SAFE_INTEGER;
        const best = front.get(entry.region);
        if (best === undefined || order < best.order)
          front.set(entry.region, { order, view: entry.id });
      }
      const resources = new Set<string>();
      for (const { view } of front.values()) {
        const resource = host.fileResource(view);
        if (resource !== undefined) resources.add(resource);
      }
      return resources;
    };
    /** Push one view's chrome and, for the active one, tell the app to match. */
    const sync = (): void => {
      const entries = new Map(editors.snapshot().map((entry) => [entry.resource, entry] as const));
      const active = layout.activeView();
      const shown = shownFiles();
      // The app's current editor is a file prac **shows**, so the two already agree
      // that a file is current; *which* region holds it is prac's business, and
      // `focusFile` keeps that side in step. Activating the centre's front view here
      // instead is what made two regions each showing a file fight forever: measured,
      // `focusFile` (the region the person is in) and this loop alternated thousands
      // of times a second until the page's main thread stopped answering.
      const current = [...entries.values()].find((entry) => entry.active)?.resource;
      const agreed = current !== undefined && shown.has(current);
      for (const { view } of fileEntries()) {
        const resource = host.fileResource(view);
        if (resource === undefined) continue;
        const entry = entries.get(resource);
        layout.setViewFlags(view, {
          dirty: entry?.dirty === true,
          preview: entry?.preview === true,
          // A file can be closed from its tab: this package owns what that means (the
          // app's editor closes, and the view retracts with it).
          closable: true,
        });
        // prac's front view and the app's active editor are two states; this package is
        // where they meet, and this is the one direction that travels: prac's front
        // view pulls the app when the app is not already showing a file.
        if (!agreed && view === active && entry !== undefined && !entry.active) {
          editors.actions.activate(resource);
        }
      }
    };
    sync();
    const stopEditors = editors.subscribe(sync);
    // The tab's close button asks; this package closes the app's editor, which is what
    // takes the view away (the mechanism never removes a view on its own).
    const stopClose = layout.onDidRequestCloseView((view) => {
      const resource = host.fileResource(view);
      if (resource !== undefined) editors.actions.close(resource);
    });
    // prac's own front view changes without the app knowing (a tab click), so the
    // layout is a source too.
    const stopLayout = layout.subscribe(sync);
    return () => {
      stopLayout();
      stopEditors();
      stopClose();
    };
  }, "prac-client-ui-vscode-editor: chrome + active editor");
  ctx.effect(
    () =>
      slots.inject(SLOT, () => {
        /** The live registration per file view, so a closed file can retract. */
        const registered = new Map<string, () => void>();
        const sync = (): void => {
          const entries = fileEntries();
          const wanted = new Set(entries.map((entry) => entry.view));
          for (const [view, dispose] of Array.from(registered)) {
            if (wanted.has(view)) continue;
            dispose();
            registered.delete(view);
          }
          for (const { view } of entries) {
            if (registered.has(view)) continue;
            // The component renders an empty host until the app has mounted the
            // file, then fills it — the bridge's direction, one level up.
            registered.set(
              view,
              slots.register({ name: SLOT, id: view }, () => host.hostFor(view)() ?? null),
            );
          }
        };
        sync();
        const stop = host.onDidChangeCatalogue(sync);
        return () => {
          stop();
          for (const dispose of registered.values()) dispose();
          registered.clear();
        };
      }),
    "prac-client-ui-vscode-editor: one view per open file",
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-editor";

/** The DSH services this plugin needs: the slot, the mechanism, and the app face. */
export const inject = ["slots", "pracVscode", "pracLayout"];
