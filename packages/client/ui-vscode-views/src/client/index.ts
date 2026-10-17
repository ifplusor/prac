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
import type {
  PracVscodeAction,
  PracVscodeFace,
  VscodeCatalogueEntry,
} from "prac-client-vscode-host/client";
import type { ViewSlotKey } from "prac-client-ui-layout/client";

/** The slot these views are registered into (checked against the mechanism's key). */
const SLOT: ViewSlotKey = "prac.view";
const CONTAINER_ACTIONS = "prac.containerActions" as const;

/**
 * One container's title actions, rendered by the frame's container bar.
 *
 * @param props - the app face and the container id.
 */
function ContainerActions({
  host,
  containerId,
}: {
  host: PracVscodeFace;
  containerId: string;
}): ReactElement | null {
  const actions: readonly PracVscodeAction[] = host.containerActions(containerId);
  if (actions.length === 0) return null;
  return createElement(
    "div",
    {
      "data-prac-container-action-bar": containerId,
      style: { display: "flex", alignItems: "center", height: "100%", gap: "2px" },
    },
    ...actions.map((action) =>
      createElement(
        "button",
        {
          key: action.id,
          type: "button",
          "data-prac-container-action": action.id,
          title: action.tooltip ?? action.label,
          "aria-label": action.label,
          disabled: !action.enabled,
          onClick: () => {
            void host.runCommand(action.id);
          },
          style: {
            font: "inherit",
            fontSize: "11px",
            height: "100%",
            padding: "0 5px",
            border: 0,
            background: "transparent",
            color: "inherit",
            cursor: action.enabled ? "pointer" : "default",
            opacity: action.enabled ? 1 : 0.55,
          },
        },
        action.label,
      ),
    ),
  );
}

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
            // `icon` is this adapter's extra slot option; the registry's base
            // options type does not know it, so keep it out of the literal's
            // excess-property check.
            const options = { name: SLOT, id: view, label, icon };
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

  // One container-action registration per container the app offers. The frame's
  // container bar picks the active container's entry; the actions come from the
  // workbench's `MenuId.ViewContainerTitle` menu.
  ctx.effect(
    () =>
      slots.inject(CONTAINER_ACTIONS, () => {
        const registered = new Map<string, { dispose: () => void }>();
        const sync = (): void => {
          const ids = new Set<string>();
          for (const entry of host.catalogue()) {
            if (entry.source === "view" && entry.containerId !== undefined)
              ids.add(entry.containerId);
          }
          for (const [id, record] of Array.from(registered)) {
            if (ids.has(id)) continue;
            record.dispose();
            registered.delete(id);
          }
          for (const id of ids) {
            if (registered.has(id)) continue;
            registered.set(id, {
              dispose: slots.register({ name: CONTAINER_ACTIONS, key: id }, () =>
                createElement(ContainerActions, { host, containerId: id }),
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
    "prac-client-ui-vscode-views: container actions",
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-views";

/** The DSH services this plugin needs: the slot, and the mechanism that fills it. */
export const inject = ["slots", "pracVscode"];
