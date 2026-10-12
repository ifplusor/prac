/**
 * prac's layout: the frame mechanism — the client half.
 *
 * Replaces `dsh-client-ui-layout`'s fixed three-column frame. Four ideas drive it:
 *
 * 1. **Regions are a tree.** A region is a leaf of the region tree with a size
 *    and a minimum; regions nest inside row/column splits. Nothing in a region
 *    says what may go in it. Which view sits where is *data* (`views`), so any
 *    view can be placed in any region — constraints (if we ever want them)
 *    belong in a policy layer, never in the region model.
 * 2. **The view catalogue, not a list of views.** A view id is
 *    `<source>:<name>`. `dsh:` names a slot DSH's own plugins register into
 *    (`dsh:sidebar`, `dsh:main:<key>`, `dsh:rightbar`) — their slot names are
 *    view *identities*, not positions, and because this frame is the renderer,
 *    *where* each one lands is the arrangement's decision. Anything else is a
 *    view some surface declares into the `prac.view` slot and names with its own
 *    source tag (`vscode:view:<app view id>` is a VS Code part host); which ids those are is read
 *    from the registry, never assumed from the tag. The mechanism ships **no concrete
 *    view name and no default placement**: the bundle's arrangement says what
 *    goes where through {@link PracLayoutFace}. The catalogue itself is
 *    *queryable* — {@link PracLayoutFace.listViews} enumerates the slot
 *    registry live (so a later `main` key or `prac.view` entry appears) and
 *    joins it with each view's placement, which is what lets a UI offer the
 *    views that are hidden or unplaced, not just the visible ones.
 * 3. **Sashes and collapse are frame-owned.** Dragging a sash adjusts the two
 *    regions beside it; collapsing a region remembers its width so expanding
 *    restores it. This is the (b) option from the integration note: the frame
 *    stays React-owned (DSH-style), and VS Code parts remain *hosted* — a
 *    region renders a view, and the `vscode:view:<app view id>` view renders the part host the
 *    client mechanism publishes (`ctx.pracVscode.partHost`); the part is re-parented
 *    there, never recreated. The host
 *    mechanism is never bypassed.
 * 4. **Roles, not positions, are what the borrowed face speaks.** DSH's
 *    plugins still call `ctx.layout`; that compat shim translates positional
 *    vocabulary into placements using the roles the arrangement binds
 *    (`bindRoles({ primarySidebar: 'dsh:sidebar', secondarySidebar: 'dsh:rightbar' })`). The
 *    mechanism never hard-codes which view plays a role.
 *
 * It keeps the contracts the rest of DSH registers against: the four region slot
 * declarations plus the `prac.view` slot, `ctx.layout`, `ctx.pracLayout`, the
 * `panelInfo` root hook, theme presentation and the document title.
 *
 * This file is the plugin body as an ordinary ESM module (`name`, `inject`,
 * `apply`). DSH's closure-factory artifact (`window.__ModuleLoader__.load`) is
 * produced by the `pack` config in `vite.config.ts` (`scripts/pack-client.ts`);
 * because the loader's
 * `require` resolves only platform seeds and materialized bundle ids, the module
 * is deliberately self-contained (only `react` stays external).
 *
 * @module prac-client-ui-layout/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ThemeSnapshot } from "@deepseek-ai/dsh-client-ui-theme/client";
import type { PracLayoutFace } from "./contract.js";
import { createFrame, ensureStyles } from "./frame.js";
import { createServices } from "./services.js";
import { createStore } from "./store.js";
import { ThemePresenter } from "./theme.js";

declare global {
  /**
   * Page-level probe the verification drivers reach the layout face through
   * (`vendor/vscode/scripts/verify-{layout,views}.mjs` read it).
   *
   * Published by this module's `apply`; removal is scoped to the instance that
   * published it.
   */
  var __pracLayout: PracLayoutFace | undefined;
}
import { VIEW_SLOT, readDeclaredViewIds, type RegionInfo, type ViewInfo } from "./catalogue.js";
export type { PracLayoutFace, RegionInfo, ViewInfo };

/**
 * Install the mechanism: declare the frame's slots, publish the faces, keep the
 * catalogue live, and wire the theme presenter.
 *
 * Everything it publishes is a `ctx.effect` cleanup, so unloading this plugin
 * (or re-declaring the root slot) retracts exactly what it installed.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  ensureStyles();
  // The frame reports a close request through the store; this set is what carries it to
  // whoever declared the view (the face's `onDidRequestCloseView`).
  const closeListeners = new Set<(viewId: string) => void>();
  const store = createStore((viewId) => {
    for (const listener of [...closeListeners]) listener(viewId);
  });
  const { layout, pracLayout, panelInfo } = createServices(ctx, store, closeListeners);

  ctx.effect(() => {
    // A view may already have registered (activation order is not ours to
    // choose), so read the slot registry before the frame can render.
    readDeclaredViewIds(ctx.slots);
    const disposeRoot = ctx.slots.register(
      {
        name: "root",
        children: {
          sidebar: { kind: "single", scope: "root" },
          main: { kind: "keyed", scope: "root" },
          rightbar: { kind: "single", scope: "root" },
          "shell.overlay": { kind: "list", scope: "root" },
          // The slot prac's own views (`prac:*`) and VS part hosts (`vscode:*`)
          // register into; the entry's declared id is its view id.
          "prac.view": { kind: "list", scope: "root" },
        },
      },
      // The current session is the frame's business (it titles the page): the source comes
      // from the session adapter, which is where this shell keeps navigation now.
      createFrame(store, {
        currentSession: ctx.uiSession.adapter.current,
      }),
    );
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } });
    // The faces other plugins consume, on the documented service channel
    // (`ctx.provide`, the same registry `Service`'s constructor registers
    // through — see `dsh.d.ts`).
    //
    // This face is a **hand-written mirror** of DSH's `ILayout` (the doc comments explain
    // prac's deviations), and a mirror loses members silently: measured, upstream's
    // `ui-sidebar-right` reads `layout.panelInfo`, this face did not publish it, and the
    // whole shell stopped activating — 12 entries failed, the only error a `getSnapshot` of
    // undefined. A `satisfies ILayout` guard here would catch the next one, but it cannot
    // be stated today: this repository type-checks against the **published** DSH
    // (`0.1.5-rc.1`, see the catalog) while the app runs the checkout's packages, so the
    // two `ILayout`s are different types. Aligning that consumption is what makes the
    // guard possible — see the note in `2026-10-07-editor-host.md`.
    const disposeLayout = ctx.provide("layout", layout);
    const disposePracLayout = ctx.provide("pracLayout", pracLayout);
    // The catalogue's live sources. `listViews()` reads the registry on every
    // call, so a later registration is already visible; these subscriptions
    // only bump `catalogueVersion`, which is how a subscribed UI (and this
    // frame) learns to re-read it — and refresh which views the slot declares,
    // which is what the frame dispatches on.
    const bumpCatalogue = (): void => {
      readDeclaredViewIds(ctx.slots);
      store.update((current) => ({
        ...current,
        catalogueVersion: current.catalogueVersion + 1,
      }));
    };
    const offMain = ctx.slots.subscribe("main", bumpCatalogue);
    const stopSlot = ctx.slots.subscribe(VIEW_SLOT, bumpCatalogue);
    // A page-level probe for verification: the bundle's `require` resolves
    // only registered bundle ids, so a driver script cannot reach the
    // Cordis context. Publishing the face is the minimal honest door —
    // removal is scoped to the instance we published.
    globalThis.__pracLayout = pracLayout;
    return () => {
      if (globalThis.__pracLayout === pracLayout) delete globalThis.__pracLayout;
      stopSlot();
      offMain();
      disposePracLayout();
      disposeLayout();
      disposePanelInfo();
      disposeRoot();
    };
  }, "prac-client-ui-layout: frame + services");

  ctx.effect(() => {
    const presenter = new ThemePresenter();
    presenter.apply(ctx.theme.getTheme());
    const off = ctx.on("theme/change", (snapshot: ThemeSnapshot) => {
      presenter.apply(snapshot);
    });
    return () => {
      off();
      presenter.dispose();
    };
  }, "prac-client-ui-layout: theme presenter");
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-layout";

/** The DSH services this plugin needs: the slot registry and the theme service. */
export const inject = ["slots", "theme", "uiSession"];
