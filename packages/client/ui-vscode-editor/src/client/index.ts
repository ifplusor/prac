/**
 * prac-client-ui-vscode-editor — the editor seat.
 *
 * Declares **one `prac.view` entry per open file** (decision 17): the app
 * contributes a file's editing surface, and this seat turns the app's open-file
 * set into views. Which files are open comes from the app's own editor service
 * (an explorer click, a command, a go-to-definition), through the shared
 * mechanism's `onDidChangeFileViews`; the view id is `vscode:file:<resource>`, and
 * the mapping between id and resource belongs to `prac-client-vscode-host`.
 *
 * The mechanism arrives as an injected **service** (`ctx.pracVscode`) rather than
 * as an import, because each client plugin is bundled and inlined on its own: an
 * imported module would duplicate the singleton boot guard. Injecting it is what
 * lets the seats be separate bundles, each placeable, showable, or disabled on
 * its own.
 *
 * Placement is not decided here. The arrangement (`prac-web-app`) puts a newly
 * opened file in the centre; the mechanism renders it in whatever region that is
 * and owns the tab strip over several files. What the mechanism cannot know — the
 * app's unsaved/preview state, and which file the app has active — the seat reads
 * from the `editors` capability and pushes (chrome flags, and `activate` when
 * prac's front view moves).
 *
 * @module prac-client-ui-vscode-editor/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { PracVscodeFace } from "prac-client-vscode-host/client";
import type { PracLayoutFace, ViewSeatKey } from "prac-client-ui-layout/client";

/** The seat these views are declared into (checked against the mechanism's key). */
const SEAT: ViewSeatKey = "prac.view";

/**
 * Declare one seat entry per open file, and keep that set in sync with the app.
 *
 * The seat is declared by `prac-client-ui-layout`'s frame, so injecting waits for
 * that declaration (either client plugin may activate first). Each entry is a
 * registration of its own — the mechanism's view catalogue reads the registry, so
 * a file appearing or closing is exactly a registration appearing or going away.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The mechanism comes from the service registry; naming its published face here
  // is what keeps this seat's use of it checked.
  const host: PracVscodeFace = ctx.pracVscode;
  const slots: SlotRegistry = ctx.slots;
  const layout: PracLayoutFace = ctx.pracLayout;
  // The app's own state, read through the capability: the tab's dot, its preview
  // italic, and which file the app has active. The seat owns this because the
  // views are its own — the mechanism renders what it is told and knows nothing
  // about files.
  ctx.effect(() => {
    const editors = host.capabilities.editors;
    /** Push one view's chrome and, for the active one, tell the app to match. */
    const sync = (): void => {
      const entries = new Map(editors.snapshot().map((entry) => [entry.resource, entry] as const));
      const active = layout.activeView();
      for (const { view, resource } of host.fileViews()) {
        const entry = entries.get(resource);
        layout.setViewFlags(view, {
          dirty: entry?.dirty === true,
          preview: entry?.preview === true,
        });
        // prac's active view and the app's active editor are two states; the seat
        // is where they meet. Guarded on the app's own answer, so the two
        // subscriptions cannot ping-pong.
        if (view === active && entry !== undefined && !entry.active) {
          editors.actions.activate(resource);
        }
      }
    };
    sync();
    const stopEditors = editors.subscribe(sync);
    // prac's own front view changes without the app knowing (a tab click), so the
    // layout is a source too.
    const stopLayout = layout.subscribe(sync);
    return () => {
      stopLayout();
      stopEditors();
    };
  }, "prac-client-ui-vscode-editor: chrome + active editor");
  ctx.effect(
    () =>
      slots.inject(SEAT, () => {
        /** The live registration per file view, so a closed file can retract. */
        const registered = new Map<string, () => void>();
        const sync = (): void => {
          const wanted = new Set(host.fileViews().map((entry) => entry.view));
          for (const [view, dispose] of Array.from(registered)) {
            if (wanted.has(view)) continue;
            dispose();
            registered.delete(view);
          }
          for (const { view } of host.fileViews()) {
            if (registered.has(view)) continue;
            // The component renders an empty host until the app has mounted the
            // file, then fills it — the bridge's direction, one level up.
            registered.set(
              view,
              slots.register({ name: SEAT, id: view }, () => host.fileHost(view)() ?? null),
            );
          }
        };
        sync();
        const stop = host.onDidChangeFileViews(sync);
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

/** The DSH services this plugin needs: the seat, the mechanism, and the app face. */
export const inject = ["slots", "pracVscode", "pracLayout"];
