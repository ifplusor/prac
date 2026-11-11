/**
 * prac-client-ui-vscode-editor — the editor package.
 *
 * Declares **one `prac.window` entry per placement** (decision 17, made precise by split
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
// Type-only, for the frame plugin's `Context` / `SlotMap` merges.
import type {} from "prac-client-ui-frame/client";
import type {
  PracVscodeAction,
  PracVscodeFace,
  VscodeCatalogueEntry,
} from "prac-client-vscode-host/client";
import type {
  PracAppDef,
  PracExtension,
  PracExtensionsFace,
  PracLayoutFace,
  PracWindowActionsFace,
  WindowAction,
  WindowActionModel,
} from "prac-client-ui-frame/client";

/**
 * Contribute the editor application, and keep its windows in step with the app.
 *
 * The editor is one **app**; each open file is a window instance the app asks the
 * window manager to admit. The manager records the instance, its title, and the
 * seat the frame renders — this package never registers a view slot.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The mechanism comes from the service registry; naming its published face here
  // is what keeps this slot's use of it checked.
  const host: PracVscodeFace = ctx.pracVscode;
  const windowActions: PracWindowActionsFace = ctx.pracWindowActions;
  // The type-only import and the ambient merge can come through different
  // declaration copies (vscode-host bundles its own), so cast at the boundary.
  const layout: PracLayoutFace = ctx.pracFrame as unknown as PracLayoutFace;
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
    /** The action model last published per view, as `placement + model` shape. */
    const lastActionShapes = new Map<string, string>();
    /**
     * How many times an empty action model has been retried per view.
     *
     * A view's group can be created after the sync that first sees it (the app
     * opens the file, then the group's actions exist), and an empty model cached
     * there would leave the tab strip with no actions until some unrelated event
     * happened to re-run the sync. The retry is bounded so a genuinely empty
     * group does not poll forever.
     */
    const emptyActionRetries = new Map<string, number>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const scheduleActionRetry = (): void => {
      const timer = setTimeout(() => {
        retryTimers.delete(timer);
        sync();
      }, 250);
      retryTimers.add(timer);
    };

    const toWindowAction = (action: PracVscodeAction): WindowAction => ({
      id: action.id,
      label: action.label,
      ...(action.icon === undefined ? {} : { icon: action.icon }),
      enabled: action.enabled,
      checked: action.checked,
      ...(action.tooltip === undefined ? {} : { tooltip: action.tooltip }),
      ...(action.submenu === undefined
        ? {}
        : { submenu: action.submenu.map((child) => toWindowAction(child)) }),
    });

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
      const active = layout.activeItem();
      for (const { view } of files) {
        const entry = entries.get(placementOfView(view) ?? "");
        layout.setItemFlags(view, {
          dirty: entry?.dirty === true,
          preview: entry?.preview === true,
          // A file can be closed from its tab: this package owns what that means (the
          // app's editor closes, and the view retracts with it).
          closable: true,
        });
      }
      const current = [...entries.values()].find((entry) => entry.active)?.placement ?? null;
      const front = placementOfView(active);
      // The editor window's title actions are the app's model, but the chrome is
      // prac's: publish them for **every** open file view, so a split's new group
      // has its own tab-strip actions before it becomes the global active view.
      const wantedActions = new Set<string>();
      for (const { view } of files) {
        const placement = host.filePlacement(view)?.placement;
        if (placement === undefined) {
          // The catalogue admits the view before the app has created its placement;
          // retry so the actions publish once the placement is known.
          if ((emptyActionRetries.get(view) ?? 0) < 40) {
            emptyActionRetries.set(view, (emptyActionRetries.get(view) ?? 0) + 1);
            scheduleActionRetry();
          }
          continue;
        }
        wantedActions.add(view);
        const model = host.editorActions(placement);
        const shape = JSON.stringify({ placement, model });
        if (lastActionShapes.get(view) === shape) continue;
        if (model.primary.length === 0 && model.secondary.length === 0) {
          windowActions.remove(view);
          // Not cached: an empty model here is usually "the group is not ready yet",
          // so a later sync must be able to publish the real one.
          lastActionShapes.delete(view);
          if ((emptyActionRetries.get(view) ?? 0) < 40) {
            emptyActionRetries.set(view, (emptyActionRetries.get(view) ?? 0) + 1);
            scheduleActionRetry();
          }
        } else {
          emptyActionRetries.delete(view);
          const actionModel: WindowActionModel = {
            primary: model.primary.map(toWindowAction),
            secondary: model.secondary.map(toWindowAction),
          };
          windowActions.set(view, actionModel, (id) => host.runEditorAction(placement, id));
        }
        lastActionShapes.set(view, shape);
      }
      for (const view of lastActionShapes.keys()) {
        if (wantedActions.has(view)) continue;
        windowActions.remove(view);
        lastActionShapes.delete(view);
      }
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
    const stopClose = layout.onDidRequestCloseItem((view) => {
      // The tab names one **placement**: the same file may be open in another region, and
      // that region's editor is not what this × asks about.
      const placement = host.filePlacement(view);
      if (placement !== undefined) editors.actions.close(placement.placement, placement.resource);
    });
    // prac's own front view changes without the app knowing (a tab click), so the
    // layout is a source too.
    const stopLayout = layout.subscribe(sync);
    // The catalogue is how a view learns its placement: a sync that ran while the
    // placement was still missing has to run again when it arrives.
    const stopCatalogue = host.onDidChangeCatalogue(sync);
    return () => {
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const view of lastActionShapes.keys()) windowActions.remove(view);
      lastActionShapes.clear();
      stopLayout();
      stopCatalogue();
      stopEditors();
      stopClose();
    };
  }, "prac-client-ui-vscode-editor: chrome + active editor");
  // The editor app and its windows go through the extension contract: the
  // adapter says which app / windows exist and what one renders; the registry
  // registers the app and opens / closes the windows.
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  const editorApp: PracAppDef = {
    id: "editor",
    version: "1",
    label: "Editor",
    instances: "multi",
    defaultRegion: "center",
    paneHeader: true,
  };
  const extension: PracExtension = {
    manifest: { id: "prac.vscode-editor", version: "1" },
    apps: () => [editorApp],
    appRuntime: (def) =>
      def.id === "editor"
        ? {
            content: (windowId: string) => host.hostFor(windowId) ?? (() => null),
            // The editor is the fallback app: it claims everything the document
            // app does not, so it must be asked last (or match the complement).
            match: (resource: string): boolean =>
              !/\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|svg)$/iu.test(resource),
          }
        : undefined,
    onDidChange: (listener: () => void) => host.onDidChangeCatalogue(listener),
  };
  ctx.effect(
    () => extensions.register(extension),
    "prac-client-ui-vscode-editor: editor app + windows",
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-editor";

/** The DSH services this plugin needs: the app + window faces, the mechanism and the layout. */
export const inject = ["pracExtensions", "pracVscode", "pracFrame", "pracWindowActions"];
