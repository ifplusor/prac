/**
 * prac-client-vscode-host — prac's row onto the embedded VS Code app.
 *
 * The mechanism (boot once per page, part hosts, theme copying, the app's command
 * namespace) lives in `prac-vscode-embed/client`. What lives here is prac's
 * policy, and nothing about placement:
 *
 * 1. **when the app may boot** — only once DSH reports a workspace, because the
 *    workspace is the window's identity and that identity is fixed for the life
 *    of the page;
 * 2. **the app's catalogue, as prac views** — the two upstream sources (the editor
 *    service's open files, the view registry's active views) published as one
 *    shape, together with the view-id convention and the mount entry point; which
 *    entries a package turns into `prac.view` registrations is that package's
 *    policy;
 * 3. **the face** — published on the DSH service registry, which is what makes
 *    `inject: ["pracVscode"]` keep a consumer pending until the mechanism is there.
 *
 * The consumers are separate packages (`prac-client-ui-vscode-editor`,
 * `prac-client-ui-vscode-views`), and *where* each view goes is the arrangement's
 * (`prac-web-app`).
 *
 * The file is a plugin body as an ordinary ESM module (`name`, `inject`,
 * `apply`) plus exports the consumer packages import. DSH's closure-factory artifact
 * (`window.__ModuleLoader__.load`) is produced by the `pack` config in
 * `vite.config.ts` (`scripts/pack-client.ts`); only `react` stays external.
 *
 * @module prac-client-vscode-host/client
 */

import type { ReactElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
// Type-only: loads the `ctx.uiSession` augmentation without emitting a runtime import
// (a value import here would inline DSH's session client into this bundle).
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type { SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ILayout } from "@deepseek-ai/dsh-client-ui-layout/client";
import { createVscodeEmbed } from "prac-vscode-embed/client";
import { EXTENSIONS_GALLERY } from "prac-vscode";
import type { PracVscodeFace, VscodeCatalogueEntry } from "./public.js";

/** Same-origin prefix the host half serves the app bundle under. */
const VSCODE_ROUTE = "/prac-vscode";

/**
 * The frame's whole-surface overlay slot: where the app's own root is mounted.
 *
 * One layer, not two: the app's floats (quick input, notifications, menus,
 * dialogs) belong to the frame's floating layer, so they take their box and
 * their order from it. The entry's `order` is negative on purpose — the frame's
 * own surfaces register with the default, and the layer's order is what decides
 * which side paints above the other, so prac's own overlays stay on top instead
 * of it being an accident of DOM insertion.
 */
const OVERLAY = "shell.overlay" satisfies keyof SlotMap;
const FLOAT_ENTRY_ORDER = -100;

/**
 * The workspace the app is started for.
 *
 * It comes from DSH, which owns the workspace registry and binds sessions to
 * workspaces — so the app must be told the *session's* workspace rather
 * than assume one. That is also why it cannot start before a
 * workspace is known: the construction options decide the window's workspace
 * identity (`workspace.id`, which scopes storage, configuration and profile) and
 * that identity is fixed for the life of the page — it cannot be corrected
 * afterwards.
 */
interface WorkspaceLaunch {
  /** Absolute path of the workspace folder. */
  readonly path: string;
}

/** The tail of an app resource, for a file view's display name. */
function fileTitle(resource: string): string {
  const withoutQuery = resource.split("?")[0] ?? resource;
  const segments = withoutQuery.split("/");
  const tail = segments[segments.length - 1] ?? "";
  return tail === "" ? resource : decodeURIComponent(tail);
}

/** The app's location word, as the catalogue's default-placement hint. */
function viewLocation(location: string): VscodeCatalogueEntry["location"] {
  return location === "sidebar" || location === "panel" || location === "auxiliarybar"
    ? location
    : "sidebar";
}

/**
 * The workspace this window is for, if there is one.
 *
 * Mirrors how `ui-workspace` resolves it: the workspaces registry holds the
 * `sessionIds` of each workspace, so the current workspace is the one containing
 * the current session — falling back to the most recent workspace. Reading it
 * from DSH rather than assuming a path is the whole point: the workspace is a
 * session fact, not a build-time constant.
 *
 * @param ctx - the Cordis client context.
 * @returns the workspace to launch for, or undefined when none is selected.
 */
function activeWorkspace(ctx: Context): WorkspaceLaunch | undefined {
  try {
    const items = ctx.workspaces.list.getSnapshot().items;
    // Navigation left the session *list* in the shell this repository runs; the current
    // session's identity is published by the session adapter.
    const current = ctx.uiSession.adapter.current.getSnapshot().key;
    if (current !== undefined) {
      const owning = items.find((item) => item.sessionIds.includes(current));
      if (owning !== undefined) return { path: owning.path };
    }
    // No session yet: the most recent workspace is the one the shell would show
    // (`ui-workspace` calls it `recent` and uses it as the same fallback).
    const recent = [...items].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
    return recent === undefined ? undefined : { path: recent.path };
  } catch {
    return undefined;
  }
}

/**
 * Publish the mechanism's face for the active workspace — once.
 *
 * The IDE side only exists once a workspace does: DSH binds sessions to
 * workspaces, so with no workspace there is nothing to open and no identity to
 * give the app. Booting waits for the registry to produce one, then fires
 * exactly once for the life of the page (the mechanism owns that guard).
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const embed = createVscodeEmbed({
    route: VSCODE_ROUTE,
    productName: "prac",
    // The extension gallery, from the vendor's single data file: the OSS product
    // has none, and without it the product's own install path cannot work.
    extensionsGallery: { ...EXTENSIONS_GALLERY },
  });

  /** Boot the app for the active workspace; true once it is running. */
  const boot = (): boolean => {
    const workspace = activeWorkspace(ctx);
    if (workspace === undefined) return false;
    return embed.boot({
      workspacePath: workspace.path,
      // A **web** workbench defaults `files.autoSave` to `afterDelay`
      // (`files.contribution.ts:270`), while the documented behaviour is `off`.
      // prac wants the documented one: the person decides when a file is written.
      configurationDefaults: { "files.autoSave": "off" },
    });
  };

  // The consumer packages are separate bundles and cannot share the mechanism's
  // state (each is inlined independently), so the face they render through is
  // handed over on the **service registry** — the documented channel, which is
  // what makes `inject: ["pracVscode"]` keep a consumer pending until this lands.
  // This is the same seam the embed bridge crosses, one level up: the consumers
  // declare views, the mechanism owns the singleton boot and the catalogue.
  /**
   * The view-id prefix for one open file.
   *
   * The *placement* is the unit — a file in one of the app's editor groups (VS Code's
   * split editor makes the same file two of them) — so the id carries both halves:
   * `vscode:file:<placement>:<resource>`. The token is what tells two views of one file
   * apart, and the resource is what a consumer recognises the file by.
   */
  const FILE_VIEW_PREFIX = "vscode:file:";

  /** The view id for one placement. */
  const fileViewId = (placement: string, resource: string): string =>
    `${FILE_VIEW_PREFIX}${placement}:${resource}`;

  /**
   * The placement behind a file view id, or undefined for any other view.
   *
   * **Both id shapes are read**: `vscode:file:<resource>` (one view per file, the shape
   * the frame's persisted records may still carry) and
   * `vscode:file:<placement>:<resource>`. A placement token is `p<digits>` and a URI
   * scheme cannot look like that, so the two are unambiguous — which means the id
   * convention can change in one place without every consumer changing with it.
   *
   * @param view - the view id.
   */
  const placementOfFileView = (
    view: string,
  ): { placement: string; resource: string } | undefined => {
    if (!view.startsWith(FILE_VIEW_PREFIX)) return undefined;
    const rest = view.slice(FILE_VIEW_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator > 0 && /^p\d+$/.test(rest.slice(0, separator))) {
      return { placement: rest.slice(0, separator), resource: rest.slice(separator + 1) };
    }
    return { placement: "", resource: rest };
  };

  /**
   * The view-id prefix for one view the app's view registry reports.
   *
   * The second upstream source, next to the open files: the registry holds core
   * contributions and extension-contributed views alike, so this covers built-in
   * panels (Problems, Terminal, …) and whatever extensions bring.
   */
  const VIEW_VIEW_PREFIX = "vscode:view:";

  /** The view id for one app view. */
  const viewViewId = (vscodeView: string): string => `${VIEW_VIEW_PREFIX}${vscodeView}`;

  /** The app's view id behind a view id, or undefined for any other view. */
  const vscodeViewIdOf = (view: string): string | undefined =>
    view.startsWith(VIEW_VIEW_PREFIX) ? view.slice(VIEW_VIEW_PREFIX.length) : undefined;

  const face: PracVscodeFace = {
    catalogue: (): readonly VscodeCatalogueEntry[] => {
      const files: VscodeCatalogueEntry[] = embed.placements().map((placement) => ({
        view: fileViewId(placement.placement, placement.resource),
        appId: placement.resource,
        title: fileTitle(placement.resource),
        source: "file",
        location: "stage",
        // Where the app's group for this placement is shown right now (`null` until
        // the frame renders it) — the arrangement's default placement, not a decision
        // this package makes.
        region: placement.region,
      }));
      const views: VscodeCatalogueEntry[] = embed.views().map((entry) => ({
        view: viewViewId(entry.id),
        appId: entry.id,
        title: entry.title,
        source: "view",
        location: viewLocation(entry.location),
        containerId: entry.containerId,
        containerTitle: entry.containerTitle,
      }));
      return [...files, ...views];
    },
    onDidChangeCatalogue: (listener: () => void) => {
      const stopPlacements = embed.onDidChangePlacements(listener);
      const stopViews = embed.onDidChangeViews(listener);
      return () => {
        stopPlacements();
        stopViews();
      };
    },
    hostFor: (view: string): (() => ReactElement | null) => {
      const placement = placementOfFileView(view);
      if (placement !== undefined) return embed.file(placement.placement, placement.resource);
      const vscodeView = vscodeViewIdOf(view);
      return vscodeView === undefined ? () => null : embed.view(vscodeView);
    },
    filePlacement: (view: string) => placementOfFileView(view),
    fileResource: (view: string): string | undefined => placementOfFileView(view)?.resource,
    capabilities: {
      editors: {
        snapshot: () => embed.capabilities.editors.snapshot(),
        subscribe: (listener: () => void) => embed.capabilities.editors.subscribe(listener),
        settled: () => embed.capabilities.editors.settled(),
        version: () => embed.capabilities.editors.version(),
        actions: {
          activate: (resource: string) => embed.capabilities.editors.actions.activate(resource),
          close: (resource: string) => embed.capabilities.editors.actions.close(resource),
        },
      },
      diagnostics: {
        snapshot: () => embed.capabilities.diagnostics.snapshot(),
        query: (query) => embed.capabilities.diagnostics.query(query),
        subscribe: (listener: () => void) => embed.capabilities.diagnostics.subscribe(listener),
        settled: () => embed.capabilities.diagnostics.settled(),
        version: () => embed.capabilities.diagnostics.version(),
      },
    },
  };
  ctx.effect(() => ctx.provide("pracVscode", face), `${name}: pracVscode service`);

  // The app's own root goes into the frame's floating layer. Registering it here
  // (and not in a consumer) is the mechanism's business: the layer is where the
  // app is mounted, and a consumer only declares views.
  //
  // Naming the layout face is also what puts DSH's own slot keys in this program:
  // without it `shell.overlay` is not a key of `SlotMap`, so the registration
  // below would not type-check against the frame's declaration.
  ctx.layout satisfies ILayout;
  const slots: SlotRegistry = ctx.slots;
  ctx.effect(
    () =>
      slots.inject(OVERLAY, () =>
        slots.register(
          { name: OVERLAY, id: "vscode-floats", order: FLOAT_ENTRY_ORDER },
          embed.floatHost(),
        ),
      ),
    `${name}: float layer entry`,
  );

  if (!boot()) {
    // No workspace yet: wait for the registry to produce one, then boot once.
    ctx.effect(() => {
      const stop = ctx.workspaces.list.subscribe(() => {
        if (boot()) stop();
      });
      return stop;
    }, `${name}: boot on first workspace`);
  }
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-vscode-host";

/**
 * Boot reads DSH's workspace registry and session list to find the workspace its
 * window is for; it declares no view slot, because the views belong to the
 * consumer packages. It does register into the frame's floating layer, which is
 * where the app's own root is mounted.
 */
export const inject = ["workspaces", "sessions", "uiSession", "slots", "layout"];
