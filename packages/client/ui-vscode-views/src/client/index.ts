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

import { createElement, useLayoutEffect, useRef } from "react";
import type { ReactElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { PracVscodeFace, VscodeCatalogueEntry } from "prac-client-vscode-host/client";
// Type-only: brings the frame's slot declarations into this program.
import type {} from "prac-client-ui-frame/lib";

/** The slot these views are registered into (checked against the mechanism's key). */
const SLOT = "prac.widget" as const;

/**
 * Declare one view per entry of the app's view catalogue, and keep it in sync.
 *
 * The slot is declared by `ui-frame`'s frame, so injecting waits for
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
        const registered = new Map<string, { label: string; icon: string; dispose: () => void }>();
        /** The pane header's title per view; survives a catalogue re-read. */
        const paneTitles = new Map<string, string>();
        /** The pane header's icon class per view. */
        const paneIcons = new Map<string, string>();
        const sync = (): void => {
          const entries = viewEntries();
          const byView = new Map(entries.map((entry) => [entry.view, entry]));
          for (const [view, record] of Array.from(registered)) {
            const entry = byView.get(view);
            if (
              entry !== undefined &&
              (paneTitles.get(view) ?? entry.title) === record.label &&
              (paneIcons.get(view) ?? "") === record.icon
            ) {
              continue;
            }
            record.dispose();
            registered.delete(view);
          }
          for (const { view, title } of entries) {
            if (registered.has(view)) continue;
            const label = paneTitles.get(view) ?? title;
            const icon = paneIcons.get(view) ?? "";
            // Resolve the mount component once per registration: hostFor can return
            // a fresh component, and a new identity on every render would remount
            // the whole view (and its pane header) forever.
            const View = host.hostFor(view);
            // `icon` and `paneHeader` are this adapter's extra slot options; the
            // registry's base options type does not know them, so keep them out of
            // the literal's excess-property check. `paneHeader` is what tells the
            // frame to overlay its fold/drag control on the app's own pane header
            // instead of drawing a second row header.
            const options = { name: SLOT, id: view, label, icon, paneHeader: true } as const;
            registered.set(view, {
              label,
              icon,
              dispose: slots.register(options, () => createElement(ViewWithTitle, { view, View })),
            });
          }
        };
        /**
         * Re-register a view after its own pane header reports a title.
         *
         * The catalogue title is the view descriptor's name; the pane header can
         * show something else (the Explorer view shows the workspace). The pane's
         * title is the one the person sees, so it wins; the catalogue entry stays
         * the fallback until the view has mounted.
         *
         * @param view - the prac view id.
         * @param label - the pane header's current title.
         */
        const retitle = (view: string, label: string, icon: string): void => {
          if (paneTitles.get(view) === label && paneIcons.get(view) === icon) return;
          paneTitles.set(view, label);
          paneIcons.set(view, icon);
          const record = registered.get(view);
          if (record === undefined) return;
          record.dispose();
          registered.delete(view);
          sync();
        };
        /**
         * The view plus a title observer.
         *
         * The pane header lives in the frame's isolated shadow, which is also this
         * component's root; observe that root rather than the global document. It
         * is deliberately a **pull from the rendered chrome**, not a second view
         * model: the pane header is the authority for the view's own title.
         *
         * @param props - the view id.
         */
        function ViewWithTitle({
          view,
          View,
        }: {
          view: string;
          View: () => ReactElement | null;
        }): ReactElement | null {
          const ref = useRef<HTMLDivElement | null>(null);
          useLayoutEffect(() => {
            const root = ref.current?.getRootNode();
            if (!(root instanceof ShadowRoot)) return undefined;
            const read = (): void => {
              const label = root.querySelector(".pane-header .title")?.textContent?.trim();
              const icon = root.querySelector(".pane-header .icon")?.className ?? "";
              if (label !== undefined && label !== "") retitle(view, label, icon);
            };
            read();
            const observer = new MutationObserver(read);
            observer.observe(root, { childList: true, subtree: true, characterData: true });
            return () => observer.disconnect();
          }, [view]);
          return createElement(
            "div",
            {
              ref,
              style: { display: "contents" },
            },
            createElement(View),
          );
        }
        sync();
        const stop = host.onDidChangeCatalogue(sync);
        return () => {
          stop();
          for (const { dispose } of registered.values()) dispose();
          registered.clear();
          paneTitles.clear();
          paneIcons.clear();
        };
      }),
    "prac-client-ui-vscode-views: one view per app view",
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-views";

/** The DSH services this plugin needs: the slot, and the mechanism that fills it. */
export const inject = ["slots", "pracVscode"];
