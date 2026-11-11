/**
 * prac-client-ui-vscode-views — the VS Code views package.
 *
 * Contributes **one `prac.widget` per view the app's view registry reports**:
 * the core contributions (Folders, Search, SCM, Run, …) and the views extensions
 * contribute alike — both register into the same upstream registry, so this
 * package does not distinguish them, nor core from extension.
 *
 * The registration itself belongs to the shared mechanism: this package is a
 * `PracExtension` (`ctx.pracExtensions`), and the registry turns its widgets into
 * registrations, re-registering when a view's chrome changes (a pane header
 * showing a different title).
 *
 * Placement is not decided here. The arrangement (`prac-web-app`) owns the
 * default region (from the entry's `location`) and the list of views it leaves
 * off screen.
 *
 * @module prac-client-ui-vscode-views/client
 */

import { createElement, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { PracVscodeFace } from "prac-client-vscode-host/client";
import type { PracExtension, PracExtensionsFace, PracWidgetDef } from "prac-client-ui-frame/client";
// Type-only, for the frame plugin's `Context` / `SlotMap` merges.
import type {} from "prac-client-ui-frame/client";

/**
 * An extension over the app's view registry.
 *
 * @param host - the mechanism face.
 * @param onRetitle - called when a view's own pane header reports a new title.
 * @returns the extension the registry registers.
 */
function viewExtension(host: PracVscodeFace, onRetitle: () => void): PracExtension {
  /** The pane header's title per view; survives a catalogue re-read. */
  const paneTitles = new Map<string, string>();
  /** The pane header's icon class per view. */
  const paneIcons = new Map<string, string>();
  const widgets = (): readonly PracWidgetDef[] =>
    host
      .catalogue()
      .filter((entry) => entry.source === "view")
      .map((entry) => ({
        id: entry.view,
        version: "1",
        title: paneTitles.get(entry.view) ?? entry.title,
        icon: paneIcons.get(entry.view) ?? "",
        paneHeader: true,
      }));
  return {
    manifest: { id: "prac.vscode-views", version: "1" },
    widgets,
    onDidChange: (listener: () => void) => host.onDidChangeCatalogue(listener),
    widgetRuntime: (def) => ({
      hostFor: () => host.hostFor(def.id),
      wrap: (widgetId, content) => {
        /**
         * The view plus a title observer.
         *
         * The pane header lives in the frame's isolated shadow, which is also this
         * component's root; observe that root rather than the global document. It is
         * deliberately a **pull from the rendered chrome**, not a second view model:
         * the pane header is the authority for the view's own title.
         *
         * @param props - the view id and its content.
         */
        function ViewWithTitle({ view, View }: { view: string; View: () => ReactNode }): ReactNode {
          const ref = useRef<HTMLDivElement | null>(null);
          useLayoutEffect(() => {
            const root = ref.current?.getRootNode();
            if (!(root instanceof ShadowRoot)) return undefined;
            const read = (): void => {
              const label = root.querySelector(".pane-header .title")?.textContent?.trim();
              const icon = root.querySelector(".pane-header .icon")?.className ?? "";
              if (label === undefined || label === "") return;
              if (paneTitles.get(view) === label && paneIcons.get(view) === icon) return;
              paneTitles.set(view, label);
              paneIcons.set(view, icon);
              // The runner re-reads `contributions()` and re-registers the changed one.
              onRetitle();
            };
            read();
            const observer = new MutationObserver(read);
            observer.observe(root, { childList: true, subtree: true, characterData: true });
            return () => observer.disconnect();
          }, [view]);
          return createElement("div", { ref, style: { display: "contents" } }, createElement(View));
        }
        const view = widgetId;
        return () => createElement(ViewWithTitle, { view, View: content });
      },
    }),
  };
}

/**
 * Install the partner over the app's view registry.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const host: PracVscodeFace = ctx.pracVscode;
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  ctx.effect(() => {
    // The retitle listener is the partner's own change source; the runner
    // subscribes to `onDidChange` for both it and the catalogue.
    const listeners = new Set<() => void>();
    const notify = (): void => {
      for (const listener of listeners) listener();
    };
    const extension: PracExtension = {
      ...viewExtension(host, notify),
      onDidChange: (listener: () => void) => {
        listeners.add(listener);
        const off = host.onDidChangeCatalogue(listener);
        return () => {
          listeners.delete(listener);
          off();
        };
      },
    };
    return extensions.register(extension);
  }, "prac-client-ui-vscode-views: one widget per app view");
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-views";

/** The DSH services this plugin needs: the extension registry and the mechanism. */
export const inject = ["pracExtensions", "pracVscode"];
