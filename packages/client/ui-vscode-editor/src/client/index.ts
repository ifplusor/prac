/**
 * prac-client-ui-vscode-editor — the editor package.
 *
 * Declares **one `prac.view` entry per placement** (decision 17, made precise by split
 * editors): a placement is a file in one of the app's editor groups, the app contributes
 * that file's editing surface there, and this package turns the app's placements into
 * views. Which files are open comes from the app's own editor service (an explorer
 * click, a command, a go-to-definition); the mechanism publishes that as the
 * catalogue's `source: "file"` entries, and this package takes those — the view id is
 * `vscode:file:<placement>:<resource>`, and the mapping between id and placement belongs to
 * `prac-client-vscode-host`.
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
     * The two facts this package keeps in step, as the last sync saw them.
     *
     * The reconciliation needs to know **which side moved** since the last sync: a
     * layout that moved is a person using prac's chrome (the app follows), and an app
     * that moved is a command, a jump or the app's own UI (prac follows). Neither
     * direction can win unconditionally — insisting on either undoes the other (measured
     * both ways: always-app-follows erased a tab click; always-prac-follows erased a
     * command).
     */
    let lastFront: string | null = null;
    let lastAppActive: string | null = null;

    /** Push one view's chrome, and keep prac's front and the app's active editor aligned. */
    const sync = (): void => {
      const files = fileEntries();
      /**
       * The app's state by **placement** — a file in one editor group.
       *
       * The same file open in two regions is two entries there and two views here, so
       * neither the resource nor the group can be the key: the resource would let one
       * view read the other's active flag and dirty dot, and the group changes when the
       * placement moves. The app's own token is what a placement is called.
       */
      const entries = new Map(editors.snapshot().map((entry) => [entry.placement, entry] as const));
      const placementOfView = (view: string | null | undefined): string | null => {
        if (view === null || view === undefined) return null;
        return host.filePlacement(view)?.placement ?? null;
      };
      const active = layout.activeView();
      for (const { view } of files) {
        const entry = entries.get(placementOfView(view) ?? "");
        layout.setViewFlags(view, {
          dirty: entry?.dirty === true,
          preview: entry?.preview === true,
          // A file can be closed from its tab: this package owns what that means (the
          // app's editor closes, and the view retracts with it).
          closable: true,
        });
      }
      const current = [...entries.values()].find((entry) => entry.active)?.placement ?? null;
      const front = placementOfView(active);
      const frontMoved = active !== lastFront;
      const appMoved = current !== lastAppActive;
      lastFront = active;
      lastAppActive = current;
      if (front === current) return; // already in step
      // **Whoever moved wins.** prac's chrome moving means a person clicked a tab, so the
      // app follows the front; the app moving means a command, a jump or the app's own UI,
      // so prac follows the app. Both moving (or neither — a boot) leaves it to the app,
      // which is the source of truth for which file is current.
      const followApp = (): void => {
        const view = files.find(({ view }) => placementOfView(view) === current)?.view;
        if (view !== undefined) layout.setFront(view);
      };
      // "prac moved alone" is deliberately **not** answered with an `activate` call: the
      // frame renders a region's front view and nothing else, so a front change remounts
      // the view, and that mount is the activation — it opens the file in its group.
      // Activating from here instead was measured wrong: the pane focus that follows
      // landed while the region still showed the **previous** file's host element, whose
      // `focusin` reads as "the person works here" — so the app was pulled back to the
      // file that was just giving up the centre, prac followed it, and the file that took
      // the centre was left with no surface at all.
      if (!(frontMoved && !appMoved)) followApp();
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
