/**
 * The extension registry: turn contribution objects into a catalog snapshot.
 *
 * The registry is deliberately small: it owns registration / removal and the
 * derived catalog; it does not own windows, widgets, placement or hosts.
 * A Cordis plugin registers one extension in `apply(ctx)` and disposes it from
 * `ctx.effect`.
 *
 * @module prac-client-ui-frame/client/extension
 */

import type { Context } from "@deepseek-ai/cordis";

import { createPartnerRegistry } from "./partner.js";
import type {
  PracCatalog,
  PracContribution,
  PracExtension,
  PracExtensionManifest,
  PracExtensionOrigin,
  PracExtensionsFace,
  PracPartner,
  PracPartnerApplication,
  PracPartnerName,
} from "./contract.js";

const emptyCatalog = (): PracCatalog => ({
  version: 0,
  extensions: [],
  apps: [],
  widgets: [],
  hosts: [],
});

/**
 * Create the extension registry.
 *
 * @returns the registry; `register` returns a disposer for one extension.
 */
export function createExtensionRegistry(ctx?: Context): PracExtensionsFace {
  const extensions = new Map<string, PracExtension>();
  const runtimes = new Map<string, () => void>();
  const projector = ctx === undefined ? undefined : createPartnerRegistry(ctx);
  const listeners = new Set<() => void>();
  let version = 0;
  let catalog = emptyCatalog();

  const partnerName = (origin: PracExtensionOrigin): PracPartnerName =>
    (origin === "vscode" || origin === "dsh" ? origin : "prac") as PracPartnerName;

  const partnerOf = (extension: PracExtension): PracPartner => ({
    name: partnerName(extension.manifest.origin),
    contributions: (): readonly PracContribution[] =>
      (extension.widgets?.() ?? []).map((widget) => ({
        id: widget.id,
        kind: "widget",
        label: widget.title,
        ...(widget.icon === undefined ? {} : { icon: widget.icon }),
        ...(widget.paneHeader === true ? { paneHeader: true } : {}),
        ...(widget.actions === undefined ? {} : { actions: widget.actions }),
      })),
    onDidChange: (listener: () => void) => extension.onDidChange?.(listener) ?? (() => {}),
    hostFor: (id) => extension.hostFor?.(id) ?? (() => null),
    ...(extension.wrap === undefined
      ? {}
      : { wrap: (contribution, host) => extension.wrap?.(contribution.id, host) ?? host }),
    applications: (): readonly PracPartnerApplication[] =>
      (extension.apps?.() ?? []).map((app) => ({
        id: app.id,
        label: app.label,
        instances: app.instances,
        ...(app.defaultRegion === undefined ? {} : { defaultRegion: app.defaultRegion }),
        ...(app.paneHeader === true ? { paneHeader: true } : {}),
        content: (windowId: string) => extension.contentFor?.(windowId) ?? (() => null),
        windows: () => extension.windows?.(app.id) ?? [],
      })),
  });

  const rebuild = (): void => {
    const manifests: PracExtensionManifest[] = [];
    const apps: PracCatalog["apps"][number][] = [];
    const widgets: PracCatalog["widgets"][number][] = [];
    const hosts: PracCatalog["hosts"][number][] = [];
    const appIds = new Set<string>();
    const widgetIds = new Set<string>();

    for (const extension of extensions.values()) {
      manifests.push(extension.manifest);
      for (const app of extension.apps?.() ?? []) {
        if (appIds.has(app.id)) throw new Error(`duplicate app id: ${app.id}`);
        appIds.add(app.id);
        apps.push(app);
      }
      for (const widget of extension.widgets?.() ?? []) {
        if (widgetIds.has(widget.id)) throw new Error(`duplicate widget id: ${widget.id}`);
        widgetIds.add(widget.id);
        widgets.push(widget);
      }
      for (const id of extension.manifest.provides ?? []) {
        hosts.push({ id, version: extension.manifest.version, status: "ready" });
      }
    }

    version += 1;
    catalog = {
      version,
      extensions: manifests,
      apps,
      widgets,
      hosts,
    };
    for (const listener of Array.from(listeners)) listener();
  };

  const watch = (extension: PracExtension): (() => void) => {
    if (extension.onDidChange === undefined) return () => {};
    return extension.onDidChange(() => {
      if (extensions.get(extension.manifest.id) !== extension) return;
      rebuild();
    });
  };

  return {
    register(extension: PracExtension): () => void {
      if (extensions.has(extension.manifest.id)) {
        throw new Error(`duplicate extension id: ${extension.manifest.id}`);
      }
      extensions.set(extension.manifest.id, extension);
      const stop = watch(extension);
      try {
        rebuild();
        if (projector !== undefined) {
          runtimes.set(extension.manifest.id, projector.register(partnerOf(extension)));
        }
      } catch (error) {
        runtimes.get(extension.manifest.id)?.();
        runtimes.delete(extension.manifest.id);
        extensions.delete(extension.manifest.id);
        stop();
        rebuild();
        throw error;
      }
      return () => {
        stop();
        runtimes.get(extension.manifest.id)?.();
        runtimes.delete(extension.manifest.id);
        if (extensions.get(extension.manifest.id) !== extension) return;
        extensions.delete(extension.manifest.id);
        rebuild();
      };
    },
    list: () => [...extensions.values()].map((extension) => extension.manifest),
    catalog: () => catalog,
    onDidChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
