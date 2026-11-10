/**
 * The extension registry: turn contribution objects into a catalog and the
 * frame's registrations.
 *
 * The registry owns registration / removal, the derived catalog, and the
 * projection into `prac.widget` / `pracApplications` / `pracWindows`. It does
 * not own placement or active state. A Cordis plugin registers one extension in
 * `apply(ctx)` and disposes it from `ctx.effect`.
 *
 * @module prac-client-ui-frame/client/extension
 */

import type { Context } from "@deepseek-ai/cordis";

import type {
  PracCatalog,
  PracExtension,
  PracExtensionManifest,
  PracExtensionsFace,
  PracWidgetDef,
} from "./contract.js";
import { WIDGET_SLOT } from "./catalogue.js";

const emptyCatalog = (): PracCatalog => ({
  version: 0,
  extensions: [],
  apps: [],
  widgets: [],
  hosts: [],
});

/** A widget definition's stable shape: changes here re-register the widget. */
const shapeOf = (widget: PracWidgetDef): string =>
  JSON.stringify({
    version: widget.version,
    title: widget.title,
    icon: widget.icon ?? "",
    paneHeader: widget.paneHeader === true,
  });

interface Projection {
  sync(): void;
  dispose(): void;
}

/**
 * Project one extension's widgets / apps into the frame services.
 *
 * @param ctx - the Cordis client context.
 * @param extension - the extension contribution object.
 * @returns the projection, or undefined when no runtime services exist.
 */
function project(ctx: Context, extension: PracExtension): Projection | undefined {
  if (ctx.pracApplications === undefined || ctx.pracWindows === undefined) return undefined;

  const widgets = new Map<string, { shape: string; dispose: () => void }>();
  const apps = new Map<string, { dispose: () => void; windows: Set<string> }>();

  const syncWidgets = (): void => {
    const wanted = new Map((extension.widgets?.() ?? []).map((widget) => [widget.id, widget]));
    for (const [id, record] of Array.from(widgets)) {
      const widget = wanted.get(id);
      if (widget !== undefined && shapeOf(widget) === record.shape) continue;
      record.dispose();
      widgets.delete(id);
    }
    for (const widget of wanted.values()) {
      if (widgets.has(widget.id)) continue;
      const host = extension.hostFor?.(widget.id) ?? (() => null);
      const content = extension.wrap?.(widget.id, host) ?? host;
      const options = {
        name: WIDGET_SLOT,
        id: widget.id,
        ...(widget.icon === undefined ? {} : { icon: widget.icon }),
        ...(widget.paneHeader === true ? { paneHeader: true } : {}),
        ...(widget.actions === undefined ? {} : { actions: widget.actions }),
        label: widget.title,
      } as const;
      widgets.set(widget.id, {
        shape: shapeOf(widget),
        dispose: ctx.slots.register(options, content),
      });
    }
  };

  const syncApps = (): void => {
    const wanted = new Map((extension.apps?.() ?? []).map((app) => [app.id, app]));
    for (const [id, record] of Array.from(apps)) {
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
            version: app.version,
            label: app.label,
            instances: app.instances,
            ...(app.defaultRegion === undefined ? {} : { defaultRegion: app.defaultRegion }),
            ...(app.paneHeader === true ? { paneHeader: true } : {}),
            ...(app.match === undefined ? {} : { match: app.match }),
            content: (windowId, render, view) =>
              extension.contentFor?.(windowId, render, view) ?? (() => null),
          }),
          windows: new Set(),
        };
        apps.set(app.id, record);
      }
      const open = new Set((extension.windows?.(app.id) ?? []).map((window) => window.id));
      for (const windowId of record.windows) {
        if (open.has(windowId)) continue;
        ctx.pracWindows.close(windowId);
        record.windows.delete(windowId);
      }
      for (const window of extension.windows?.(app.id) ?? []) {
        if (record.windows.has(window.id)) continue;
        ctx.pracWindows.admit(app.id, { windowId: window.id, title: window.title });
        record.windows.add(window.id);
      }
    }
  };

  const stopWidgets = ctx.slots.inject(WIDGET_SLOT, () => {
    syncWidgets();
    return () => {
      for (const record of widgets.values()) record.dispose();
      widgets.clear();
    };
  });

  const sync = (): void => {
    syncWidgets();
    syncApps();
  };
  sync();

  return {
    sync,
    dispose: () => {
      stopWidgets();
      for (const record of widgets.values()) record.dispose();
      widgets.clear();
      for (const record of apps.values()) {
        for (const windowId of record.windows) ctx.pracWindows.close(windowId);
        record.dispose();
      }
      apps.clear();
    },
  };
}

/**
 * Create the extension registry.
 *
 * @param ctx - the Cordis client context; omitted in pure catalog tests.
 * @returns the registry; `register` returns a disposer for one extension.
 */
export function createExtensionRegistry(ctx?: Context): PracExtensionsFace {
  const extensions = new Map<string, PracExtension>();
  const projections = new Map<string, Projection>();
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
    catalog = { version, extensions: manifests, apps, widgets, hosts };
    for (const listener of Array.from(listeners)) listener();
  };

  const watch = (extension: PracExtension): (() => void) => {
    if (extension.onDidChange === undefined) return () => {};
    return extension.onDidChange(() => {
      if (extensions.get(extension.manifest.id) !== extension) return;
      rebuild();
      projections.get(extension.manifest.id)?.sync();
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
        if (ctx !== undefined) {
          const projection = project(ctx, extension);
          if (projection !== undefined) projections.set(extension.manifest.id, projection);
        }
      } catch (error) {
        projections.get(extension.manifest.id)?.dispose();
        projections.delete(extension.manifest.id);
        extensions.delete(extension.manifest.id);
        stop();
        rebuild();
        throw error;
      }
      return () => {
        stop();
        projections.get(extension.manifest.id)?.dispose();
        projections.delete(extension.manifest.id);
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
