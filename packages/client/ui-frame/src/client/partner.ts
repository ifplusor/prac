/**
 * The partner runner: project a base partner's contributions into registrations.
 *
 * A partner (VS Code, DSH) owns content and says what it offers; prac owns the
 * composition. The runner is the only place that turns those contributions into
 * `prac.widget` registrations (and, later, application windows). It does **not**
 * own placement, regions, geometry or active state: it only keeps the
 * registrations aligned with the partner's list.
 *
 * @module prac-client-ui-frame/client/partner
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ReactNode } from "react";
import type { ApplicationSlotRenderer, ApplicationViewport } from "prac-ui-kit-workbench";

/** One thing a base partner contributes to prac. */
export interface PracContribution {
  /** Global id (`vscode:view:*`, `dsh:main:*`, `vscode:file:*`). */
  readonly id: string;
  /**
   * `app` — the contribution opens windows through the application layer;
   * `widget` — it is a composable unit a board renders. A window is prac's
   * **instance**, never the partner's unit of contribution.
   */
  readonly kind: "app" | "widget";
  readonly label?: string;
  readonly icon?: string;
  /** The content brings its own native header; the frame must not draw a second row. */
  readonly paneHeader?: boolean;
  /** The contribution's own actions; they ride the registration (not a separate seat). */
  readonly actions?: () => ReactNode;
}

/** An app a partner contributes, with the window instances it currently wants open. */
export interface PracPartnerApplication {
  readonly id: string;
  readonly label: string;
  readonly instances: "single" | "multi";
  readonly defaultRegion?: string;
  /** The content brings its own native header (the frame overlays controls only). */
  readonly paneHeader?: boolean;
  /** One window's content; resolved per instance id. */
  content(
    windowId: string,
    render?: ApplicationSlotRenderer,
    view?: ApplicationViewport,
  ): () => ReactNode;
  /** The instances the partner wants open right now. */
  windows(): readonly { readonly id: string; readonly title: string }[];
}

/** A base partner (VS Code, DSH) and how prac reads what it contributes. */
export interface PracPartner {
  /** Which base partner this plugin contributes to. */
  readonly name: PracPartnerName;
  contributions(): readonly PracContribution[];
  onDidChange(listener: () => void): () => void;
  /**
   * One contribution's content.
   *
   * Resolved once per **registration**, never per render: a fresh component on
   * every render would remount the whole view and its header.
   */
  hostFor(id: string): () => ReactNode;
  /** The partner's own wrapping of a contribution (e.g. observing its pane title). */
  wrap?(contribution: PracContribution, host: () => ReactNode): () => ReactNode;
  /** The apps the partner contributes, with their current window instances. */
  applications?(): readonly PracPartnerApplication[];
}

/**
 * The base partners. There are exactly two, and each is a **group of plugins**
 * (VS Code: the views and editor plugins; DSH: its host), not one plugin.
 */
export type PracPartnerName = "vscode" | "dsh" | "prac";

/** Origin metadata; not a branch. */
export type PracExtensionOrigin = "prac" | "vscode" | "dsh" | (string & {});

/** Declarative extension manifest. */
export interface PracExtensionManifest {
  readonly id: string;
  readonly origin: PracExtensionOrigin;
  readonly version: string;
  readonly dependsOn?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly provides?: readonly string[];
}

/** Declarative app definition. */
export interface PracAppDef {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly icon?: string;
  readonly paneHeader?: boolean;
  readonly instances: "single" | "multi";
  readonly defaultRegion?: string;
}

/** Declarative widget definition. */
export interface PracWidgetDef {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly icon?: string;
  readonly paneHeader?: boolean;
  readonly actions?: () => ReactNode;
  readonly defaultBoard?: string;
  readonly defaultRegion?: string;
}

/** One host capability declaration. */
export interface PracHostDecl {
  readonly id: string;
  readonly version: string;
  readonly status: "ready" | "starting" | "unavailable";
}

/** The derived catalog snapshot. */
export interface PracCatalog {
  readonly version: number;
  readonly extensions: readonly PracExtensionManifest[];
  readonly apps: readonly PracAppDef[];
  readonly widgets: readonly PracWidgetDef[];
  readonly hosts: readonly PracHostDecl[];
}

/** One extension runtime contribution object, registered by a Cordis plugin. */
export interface PracExtension {
  readonly manifest: PracExtensionManifest;
  apps?(): readonly PracAppDef[];
  widgets?(): readonly PracWidgetDef[];
  windows?(appId: string): readonly { readonly id: string; readonly title: string }[];
  contentFor?(
    windowId: string,
    render?: ApplicationSlotRenderer,
    view?: ApplicationViewport,
  ): () => ReactNode;
  hostFor?(widgetId: string): () => ReactNode;
  wrap?(widgetId: string, host: () => ReactNode): () => ReactNode;
  onDidChange?(listener: () => void): () => void;
}

/** The extension registry service. */
export interface PracExtensionsFace {
  register(extension: PracExtension): () => void;
  list(): readonly PracExtensionManifest[];
  catalog(): PracCatalog;
  onDidChange(listener: () => void): () => void;
}

/** The partner registry the frame provides. */
export interface PracPartnersFace {
  /** Join a base partner; several plugins may register under the same name. */
  register(partner: PracPartner): () => void;
  /** The base partners currently joined, with their provider count. */
  partners(): readonly { readonly name: PracPartnerName; readonly providers: number }[];
}

/** The content slot a `widget` contribution registers into. */
const WIDGET_SLOT = "prac.widget" as const;

/** The shape that decides whether a registration has to be replaced. */
const shapeOf = (contribution: PracContribution): string =>
  JSON.stringify({
    kind: contribution.kind,
    label: contribution.label ?? "",
    icon: contribution.icon ?? "",
    paneHeader: contribution.paneHeader === true,
  });

/**
 * Create the internal projector behind `ctx.pracExtensions`.
 *
 * @param ctx - the Cordis client context.
 * @returns the registry; `register` returns a disposer for one partner.
 */
export function createPartnerRegistry(ctx: Context): PracPartnersFace {
  /** The plugins joined to each base partner (one partner may span plugins). */
  const joined = new Map<string, Set<PracPartner>>();
  return {
    register(partner: PracPartner): () => void {
      const providers = joined.get(partner.name) ?? new Set<PracPartner>();
      providers.add(partner);
      joined.set(partner.name, providers);
      const leave = (): void => {
        providers.delete(partner);
        if (providers.size === 0) joined.delete(partner.name);
      };
      const dispose = ctx.slots.inject(WIDGET_SLOT, () => {
        const registered = new Map<string, { shape: string; dispose: () => void }>();
        const sync = (): void => {
          const contributions = partner
            .contributions()
            .filter((contribution) => contribution.kind === "widget");
          const byId = new Map(
            contributions.map((contribution) => [contribution.id, contribution]),
          );
          for (const [id, record] of Array.from(registered)) {
            const contribution = byId.get(id);
            if (contribution !== undefined && shapeOf(contribution) === record.shape) continue;
            record.dispose();
            registered.delete(id);
          }
          for (const contribution of contributions) {
            if (registered.has(contribution.id)) continue;
            const host = partner.hostFor(contribution.id);
            const content = partner.wrap?.(contribution, host) ?? host;
            // `icon` / `paneHeader` are this mechanism's extra slot options; the
            // registry's base options type does not know them, so keep them out of
            // the literal's excess-property check (the adapter did the same).
            const options = {
              name: WIDGET_SLOT,
              id: contribution.id,
              ...(contribution.label === undefined ? {} : { label: contribution.label }),
              ...(contribution.icon === undefined ? {} : { icon: contribution.icon }),
              ...(contribution.paneHeader === true ? { paneHeader: true } : {}),
              ...(contribution.actions === undefined ? {} : { actions: contribution.actions }),
            } as const;
            registered.set(contribution.id, {
              shape: shapeOf(contribution),
              dispose: ctx.slots.register(options, content),
            });
          }
        };
        // Apps the partner contributes: register each definition once and keep the
        // windows it asks for open in step (open on appearance, close on removal).
        const apps = new Map<string, { dispose: () => void; windows: Set<string> }>();
        const syncApps = (): void => {
          const wanted = new Map(
            (partner.applications?.() ?? []).map((app) => [app.id, app] as const),
          );
          for (const [id, record] of Array.from(apps)) {
            // An app lives as long as the partner still lists it; its having no
            // open window right now is normal (a file app between files), not a
            // reason to unregister it.
            if (wanted.has(id)) continue;
            for (const windowId of record.windows) ctx.pracWindows.close(windowId);
            record.dispose();
            apps.delete(id);
          }
          for (const app of wanted.values()) {
            let record = apps.get(app.id);
            if (record === undefined) {
              record = {
                dispose: ctx.pracApplications.register({
                  id: app.id,
                  label: app.label,
                  instances: app.instances,
                  ...(app.defaultRegion === undefined ? {} : { defaultRegion: app.defaultRegion }),
                  ...(app.paneHeader === true ? { paneHeader: true } : {}),
                  content: (windowId) => app.content(windowId),
                }),
                windows: new Set(),
              };
              apps.set(app.id, record);
            }
            const open = new Set(app.windows().map((window) => window.id));
            for (const windowId of record.windows) {
              if (open.has(windowId)) continue;
              ctx.pracWindows.close(windowId);
              record.windows.delete(windowId);
            }
            for (const window of app.windows()) {
              if (record.windows.has(window.id)) continue;
              ctx.pracWindows.admit(app.id, { windowId: window.id, title: window.title });
              record.windows.add(window.id);
            }
          }
        };
        sync();
        syncApps();
        const stop = partner.onDidChange(() => {
          sync();
          syncApps();
        });
        return () => {
          stop();
          for (const { dispose } of registered.values()) dispose();
          registered.clear();
          for (const record of apps.values()) {
            for (const windowId of record.windows) ctx.pracWindows.close(windowId);
            record.dispose();
          }
          apps.clear();
        };
      });
      return () => {
        leave();
        dispose();
      };
    },
    partners: () =>
      [...joined.entries()].map(([name, providers]) => ({
        name: name as PracPartner["name"],
        providers: providers.size,
      })),
  };
}
