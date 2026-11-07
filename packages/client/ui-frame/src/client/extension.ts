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

import type {
  PracCatalog,
  PracExtension,
  PracExtensionManifest,
  PracExtensionsFace,
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
export function createExtensionRegistry(): PracExtensionsFace {
  const extensions = new Map<string, PracExtension>();
  const listeners = new Set<() => void>();
  let version = 0;
  let catalog = emptyCatalog();

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
      } catch (error) {
        extensions.delete(extension.manifest.id);
        stop();
        rebuild();
        throw error;
      }
      return () => {
        stop();
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
