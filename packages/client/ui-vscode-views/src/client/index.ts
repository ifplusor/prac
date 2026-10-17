/**
 * prac-client-ui-vscode-views — the VS Code views package.
 *
 * Declares **one `prac.view` entry per view the app's view registry reports**:
 * the core contributions (Folders, Search, SCM, Run, Problems, Output, Debug
 * Console, Terminal, …) and the views extensions contribute (a tree view, a
 * webview view) alike — both register into the same upstream registry, so this
 * package does not distinguish them, nor core from extension.
 *
 * Which views exist comes from the shared mechanism's **catalogue**
 * (`source: "view"`). A view entering or leaving it — its `when` starting or
 * stopping to hold, an extension activating or going away — is exactly a
 * registration appearing or going away, so the package simply follows the
 * catalogue.
 *
 * The mechanism arrives as an injected **service** (`ctx.pracVscode`) rather than
 * as an import, because each client plugin is bundled and inlined on its own: an
 * imported module would duplicate the singleton boot guard.
 *
 * Placement is not decided here. The arrangement (`prac-web-app`) owns the
 * default region (from the entry's `location`) and the list of views it leaves
 * off screen.
 *
 * @module prac-client-ui-vscode-views/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { PracVscodeFace, VscodeCatalogueEntry } from "prac-client-vscode-host/client";
import type { ViewSlotKey } from "prac-client-ui-layout/client";

/** The slot these views are registered into (checked against the mechanism's key). */
const SLOT: ViewSlotKey = "prac.view";

/**
 * Declare one view per entry of the app's view catalogue, and keep it in sync.
 *
 * The slot is declared by `prac-client-ui-layout`'s frame, so injecting waits for
 * that declaration (either client plugin may activate first). Each entry is a
 * registration of its own — the frame's catalogue reads the registry, so a view
 * appearing or going away is exactly a registration appearing or going away.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The mechanism comes from the service registry; naming its published face here
  // is what keeps this slot's use of it checked.
  const host: PracVscodeFace = ctx.pracVscode;
  const slots: SlotRegistry = ctx.slots;
  /** The catalogue entries this package declares views for: the app's views. */
  const viewEntries = (): readonly VscodeCatalogueEntry[] =>
    host.catalogue().filter((entry) => entry.source === "view");
  ctx.effect(
    () =>
      slots.inject(SLOT, () => {
        /** The live registration per view, so a view that leaves or retitles can re-register. */
        const registered = new Map<string, { label: string; dispose: () => void }>();
        const sync = (): void => {
          const entries = viewEntries();
          const byView = new Map(entries.map((entry) => [entry.view, entry]));
          for (const [view, record] of Array.from(registered)) {
            const entry = byView.get(view);
            if (entry !== undefined && entry.title === record.label) continue;
            record.dispose();
            registered.delete(view);
          }
          for (const { view, title } of entries) {
            if (registered.has(view)) continue;
            // The component renders an empty host until the app has created the
            // view, then fills it — the bridge's direction, one level up.
            registered.set(view, {
              label: title,
              dispose: slots.register(
                { name: SLOT, id: view, label: title },
                () => host.hostFor(view)() ?? null,
              ),
            });
          }
        };
        sync();
        const stop = host.onDidChangeCatalogue(sync);
        return () => {
          stop();
          for (const { dispose } of registered.values()) dispose();
          registered.clear();
        };
      }),
    "prac-client-ui-vscode-views: one view per app view",
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-views";

/** The DSH services this plugin needs: the slot, and the mechanism that fills it. */
export const inject = ["slots", "pracVscode"];
