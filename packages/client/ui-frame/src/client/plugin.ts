/**
 * prac's layout: the frame mechanism — the client half.
 *
 * Replaces `dsh-client-ui-layout`'s fixed three-column frame. Four ideas drive it:
 *
 * 1. **Regions are a tree.** A region is a leaf of the region tree with a size
 *    and a minimum; regions nest inside row/column splits. Nothing in a region
 *    says what may go in it. Which view sits where is *data* (`items`), so any
 *    view can be placed in any region — constraints (if we ever want them)
 *    belong in a policy layer, never in the region model.
 * 2. **The view catalogue, not a list of items.** A view id is
 *    `<source>:<name>`. `dsh:` names a slot DSH's own plugins register into
 *    (`dsh:sidebar`, `dsh:main:<key>`, `dsh:rightbar`) — their slot names are
 *    view *identities*, not positions, and because this frame is the renderer,
 *    *where* each one lands is the arrangement's decision. Anything else is a
 *    view some surface declares into the `prac.view` slot and names with its own
 *    source tag (`vscode:view:<app view id>` is a VS Code part host); which ids those are is read
 *    from the registry, never assumed from the tag. The mechanism ships **no concrete
 *    view name and no default placement**: the bundle's arrangement says what
 *    goes where through {@link PracLayoutFace}. The catalogue itself is
 *    *queryable* — {@link PracLayoutFace.listItems} enumerates the slot
 *    registry live (so a later `main` key or `prac.view` entry appears) and
 *    joins it with each view's placement, which is what lets a UI offer the
 *    items that are hidden or unplaced, not just the visible ones.
 * 3. **Sashes and collapse are frame-owned.** Dragging a sash adjusts the two
 *    regions beside it; collapsing a region remembers its width so expanding
 *    restores it. This is the (b) option from the integration note: the frame
 *    stays React-owned (DSH-style), and VS Code content remains *hosted* — a
 *    region renders a view, and the `vscode:view:<app view id>` view renders the
 *    host component the client mechanism publishes (`ctx.pracVscode.hostFor(view)`).
 *    The host component re-parents the existing pane while it stays in one place;
 *    **a move across regions currently remounts it** (the editor uses that mount as
 *    its activation), which is the stable-host gap tracked in the UI architecture
 *    note. The host mechanism is never bypassed.
 * 4. **Roles, not positions, are what the borrowed face speaks.** DSH's
 *    plugins still call `ctx.layout`; that compat shim translates positional
 *    vocabulary into placements using the roles the arrangement binds
 *    (`bindRoles({ primarySidebar: 'dsh:sidebar', secondarySidebar: 'dsh:rightbar' })`). The
 *    mechanism never hard-codes which view plays a role.
 *
 * It keeps the contracts the rest of DSH registers against: the four region slot
 * declarations plus the `prac.view` slot, `ctx.layout`, `ctx.pracFrame`, the
 * `panelInfo` root hook, theme presentation and the document title.
 *
 * This file is the plugin body as an ordinary ESM module (`name`, `inject`,
 * `apply`). DSH's closure-factory artifact (`window.__ModuleLoader__.load`) is
 * produced by the `pack` config in `vite.config.ts` (`scripts/pack-client.ts`);
 * because the loader's
 * `require` resolves only platform seeds and materialized bundle ids, the module
 * is deliberately self-contained (only `react` stays external).
 *
 * @module prac-client-ui-frame/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ThemeSnapshot } from "@deepseek-ai/dsh-client-ui-theme/client";
import type {
  PracLayoutFace,
  PracSpacesFace,
  PracWindowActionsFace,
  WindowActionModel,
} from "./contract.js";
import { createFrame, ensureStyles } from "./frame.js";
import { createServices } from "./services.js";
import { createComposedStore, createStageSwitcher } from "prac-ui-kit-frame";
import { createFrameStore, createSpaceStore } from "./store.js";
import { ThemePresenter } from "./theme.js";
import { workspaceScope } from "prac-ui-kit-frame";

declare global {
  /**
   * Page-level probe the verification drivers reach the layout face through
   * (`vendor/vscode/scripts/verify-{layout,items}.mjs` read it).
   *
   * Published by this module's `apply`; removal is scoped to the instance that
   * published it.
   */
  var __pracFrame: PracLayoutFace | undefined;
  /** The board layout registry, for the live gates / a page-level probe. */
  var __pracBoardLayouts: import("prac-ui-kit-frame").BoardLayoutRegistry | undefined;
  /** The Space registry, for the live gates / a page-level probe. */
  var __pracSpaces: PracSpacesFace | undefined;
}
import { VIEW_SLOT, WIDGET_SLOT, WINDOW_SLOT, readDeclaredViewIds } from "./catalogue.js";

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
  // whoever declared the view (the face's `onDidRequestCloseItem`).
  const closeListeners = new Set<(viewId: string) => void>();
  const close = (viewId: string): void => {
    for (const listener of Array.from(closeListeners)) listener(viewId);
  };

  // The Space registry: named layouts over the same project folder. Each Space
  // owns a layout store with its own persistence key; the switcher fronts the
  // active one so the frame and the faces are built once. The scope is the
  // project folder (the same `?workspace=` the page boots from), not the origin:
  // switching folders must not carry one folder's Spaces into another.
  const scope = workspaceScope(window.location.search);
  const SPACES_KEY = `prac-spaces/v1/${scope}`;
  interface PersistedSpace {
    id: string;
    name: string;
  }
  interface PersistedSpaces {
    spaces: PersistedSpace[];
    activeId?: string;
  }
  const parseSpaces = (value: unknown): PersistedSpaces | undefined => {
    const entries = Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null
        ? (value as { spaces?: unknown }).spaces
        : undefined;
    if (!Array.isArray(entries)) return undefined;
    const spaces = entries.filter(
      (entry): entry is PersistedSpace =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PersistedSpace).id === "string" &&
        typeof (entry as PersistedSpace).name === "string",
    );
    if (spaces.length === 0) return undefined;
    const activeId =
      typeof value === "object" &&
      value !== null &&
      typeof (value as PersistedSpaces).activeId === "string"
        ? (value as PersistedSpaces).activeId
        : undefined;
    return { spaces, activeId };
  };
  const loadSpaces = (): PersistedSpaces => {
    try {
      const raw = localStorage.getItem(SPACES_KEY);
      if (raw !== null) {
        const parsed = parseSpaces(JSON.parse(raw));
        if (parsed !== undefined) return parsed;
      }
    } catch {
      // fall through to the default
    }
    return { spaces: [{ id: "space-1", name: "Space 1" }], activeId: "space-1" };
  };
  const saveSpaces = (spaces: readonly PersistedSpace[], activeId: string): void => {
    try {
      localStorage.setItem(
        SPACES_KEY,
        JSON.stringify({ version: 1, spaces: [...spaces], activeId }),
      );
    } catch {
      // persistence is best-effort
    }
  };
  const loaded = loadSpaces();
  let spaces = loaded.spaces;
  let activeId =
    loaded.activeId !== undefined && spaces.some((space) => space.id === loaded.activeId)
      ? loaded.activeId
      : (spaces[0]?.id ?? "space-1");
  const frameStore = createFrameStore(close, `prac-frame/v1/${scope}`);
  const spaceStores = new Map<string, ReturnType<typeof createSpaceStore>>();
  const spaceStoreFor = (id: string): ReturnType<typeof createSpaceStore> => {
    let store = spaceStores.get(id);
    if (store === undefined) {
      store = createSpaceStore(`prac-space/v1/${scope}/${id}`);
      spaceStores.set(id, store);
    }
    return store;
  };
  const stage = createStageSwitcher(spaceStoreFor(activeId));
  const store = createComposedStore(frameStore, stage);
  const spaceListeners = new Set<() => void>();
  const notifySpaces = (): void => {
    for (const listener of Array.from(spaceListeners)) listener();
  };
  const pracSpaces: PracSpacesFace = {
    list: () => spaces.map((space) => ({ ...space })),
    active: () => activeId,
    switchTo: (id) => {
      if (id === activeId) return;
      if (!spaces.some((space) => space.id === id)) return;
      activeId = id;
      saveSpaces(spaces, activeId);
      stage.switchTo(spaceStoreFor(id));
      notifySpaces();
    },
    create: (name) => {
      const id = `space-${Date.now().toString(36)}`;
      spaces = [...spaces, { id, name: name ?? `Space ${spaces.length + 1}` }];
      activeId = id;
      saveSpaces(spaces, activeId);
      stage.switchTo(spaceStoreFor(id));
      notifySpaces();
      return id;
    },
    rename: (id, name) => {
      spaces = spaces.map((space) => (space.id === id ? { ...space, name } : space));
      saveSpaces(spaces, activeId);
      notifySpaces();
    },
    remove: (id) => {
      if (spaces.length <= 1) return;
      if (!spaces.some((space) => space.id === id)) return;
      const wasActive = activeId === id;
      spaces = spaces.filter((space) => space.id !== id);
      if (wasActive) activeId = spaces[0]?.id ?? "space-1";
      saveSpaces(spaces, activeId);
      if (wasActive) stage.switchTo(spaceStoreFor(activeId));
      notifySpaces();
    },
    onDidChange: (listener) => {
      spaceListeners.add(listener);
      return () => spaceListeners.delete(listener);
    },
  };
  const { layout, pracFrame, panelInfo, viewGroups, surfaces, contentHosts, boardLayouts } =
    createServices(ctx, store, closeListeners);

  // The active window's resolved actions: the adapter pushes a model, the frame
  // renders it at the tab strip's right end. The entry is keyed by **view id**
  // (the tab), so switching tabs switches the model with no second active state.
  const windowActionEntries = new Map<
    string,
    { model: WindowActionModel; run: (id: string) => void }
  >();
  const windowActionListeners = new Set<() => void>();
  const windowActions: PracWindowActionsFace = {
    set: (viewId, model, run) => {
      windowActionEntries.set(viewId, { model, run });
      for (const listener of windowActionListeners) listener();
    },
    remove: (viewId) => {
      if (!windowActionEntries.delete(viewId)) return;
      for (const listener of windowActionListeners) listener();
    },
    get: (viewId) => windowActionEntries.get(viewId),
    subscribe: (listener) => {
      windowActionListeners.add(listener);
      return () => windowActionListeners.delete(listener);
    },
  };

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
          // The slot prac's own items (`prac:*`) and VS part hosts (`vscode:*`)
          // register into; the entry's declared id is its view id.
          "prac.view": { kind: "list", scope: "root" },
          "prac.window": { kind: "list", scope: "root" },
          "prac.widget": { kind: "list", scope: "root" },
          // The action surface a view may fill; keyed by its `prac.view` id.
          "prac.viewActions": { kind: "keyed", scope: "root" },
          "prac.windowActions": { kind: "keyed", scope: "root" },
          "prac.widgetActions": { kind: "keyed", scope: "root" },
          // The action surface a container may fill; keyed by its container id.
        },
      },
      // The current session is the frame's business (it titles the page): the source comes
      // from the session adapter, which is where this shell keeps navigation now.
      createFrame(store, {
        currentSession: ctx.uiSession.adapter.current,
        viewGroups,
        contentHosts,
        boardLayouts,
        windowActions,
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
    const disposePracFrame = ctx.provide("pracFrame", pracFrame);
    const disposePracSurfaces = ctx.provide("pracSurfaces", surfaces);
    const disposePracSpaces = ctx.provide("pracSpaces", pracSpaces);
    const disposeWindowActions = ctx.provide("pracWindowActions", windowActions);
    // The catalogue's live sources. `listItems()` reads the registry on every
    // call, so a later registration is already visible; these subscriptions
    // only bump `catalogueVersion`, which is how a subscribed UI (and this
    // frame) learns to re-read it — and refresh which items the slot declares,
    // which is what the frame dispatches on.
    const bumpCatalogue = (): void => {
      readDeclaredViewIds(ctx.slots);
      store.update((current) => ({
        ...current,
        catalogueVersion: current.catalogueVersion + 1,
      }));
    };
    const offMain = ctx.slots.subscribe("main", bumpCatalogue);
    // The adapters register into the split content slots (`prac.window` / `prac.widget`) since
    // the kind split; a title / icon / pane-header declared there has to reach the catalogue
    // just like a legacy `prac.view` entry, or every header falls back to the raw id.
    const stopSlots = ([VIEW_SLOT, WINDOW_SLOT, WIDGET_SLOT] as const).map((slot) =>
      ctx.slots.subscribe(slot, bumpCatalogue),
    );
    // A page-level probe for verification: the bundle's `require` resolves
    // only registered bundle ids, so a driver script cannot reach the
    // Cordis context. Publishing the face is the minimal honest door —
    // removal is scoped to the instance we published.
    globalThis.__pracFrame = pracFrame;
    // The board layout registry, published for the live gates (a board's state is not
    // reachable through the frame's view table).
    globalThis.__pracBoardLayouts = boardLayouts;
    globalThis.__pracSpaces = pracSpaces;
    return () => {
      if (globalThis.__pracFrame === pracFrame) delete globalThis.__pracFrame;
      if (globalThis.__pracBoardLayouts === boardLayouts) delete globalThis.__pracBoardLayouts;
      if (globalThis.__pracSpaces === pracSpaces) delete globalThis.__pracSpaces;
      for (const stop of stopSlots) stop();
      offMain();
      disposeWindowActions();
      windowActionEntries.clear();
      disposePracSpaces();
      disposePracSurfaces();
      disposePracFrame();
      disposeLayout();
      disposePanelInfo();
      viewGroups.dispose();
      disposeRoot();
    };
  }, "prac-client-ui-frame: frame + services");

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
  }, "prac-client-ui-frame: theme presenter");
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-frame";

/** The DSH services this plugin needs: the slot registry and the theme service. */
export const inject = ["slots", "theme", "uiSession"];
