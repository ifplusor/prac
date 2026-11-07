import { describe, expect, it } from "vite-plus/test";

import { createExtensionRegistry } from "./extension.js";
import type { PracAppDef, PracExtension, PracWidgetDef } from "./contract.js";

const app = (id: string): PracAppDef => ({
  id,
  version: "1",
  label: id,
  instances: "single",
});

const widget = (id: string): PracWidgetDef => ({
  id,
  version: "1",
  title: id,
});

const extension = (
  id: string,
  options: { apps?: readonly PracAppDef[]; widgets?: readonly PracWidgetDef[] } = {},
): PracExtension => ({
  manifest: { id, origin: "prac", version: "1", provides: ["prac.example"] },
  apps: () => options.apps ?? [],
  widgets: () => options.widgets ?? [],
});

describe("extension registry", () => {
  it("builds a catalog from registered extensions", () => {
    const registry = createExtensionRegistry();
    const off = registry.register(
      extension("prac.one", { apps: [app("editor")], widgets: [widget("files")] }),
    );

    expect(registry.list().map((manifest) => manifest.id)).toEqual(["prac.one"]);
    expect(registry.catalog().apps.map((entry) => entry.id)).toEqual(["editor"]);
    expect(registry.catalog().widgets.map((entry) => entry.id)).toEqual(["files"]);
    expect(registry.catalog().hosts).toEqual([
      { id: "prac.example", version: "1", status: "ready" },
    ]);

    off();
    expect(registry.catalog().apps).toEqual([]);
    expect(registry.catalog().widgets).toEqual([]);
  });

  it("rejects duplicate extension ids", () => {
    const registry = createExtensionRegistry();
    registry.register(extension("prac.one"));
    expect(() => registry.register(extension("prac.one"))).toThrow(/duplicate extension/);
  });

  it("rejects duplicate app and widget ids across extensions", () => {
    const registry = createExtensionRegistry();
    registry.register(extension("prac.one", { apps: [app("editor")], widgets: [widget("files")] }));

    expect(() => registry.register(extension("prac.two", { apps: [app("editor")] }))).toThrow(
      /duplicate app/,
    );
    expect(() =>
      registry.register(extension("prac.three", { widgets: [widget("files")] })),
    ).toThrow(/duplicate widget/);
    expect(registry.list().map((manifest) => manifest.id)).toEqual(["prac.one"]);
  });

  it("rebuilds on extension change", () => {
    const registry = createExtensionRegistry();
    let widgets: readonly PracWidgetDef[] = [widget("files")];
    let notify: (() => void) | undefined;
    registry.register({
      manifest: { id: "prac.one", origin: "prac", version: "1" },
      widgets: () => widgets,
      onDidChange: (listener) => {
        notify = listener;
        return () => {
          notify = undefined;
        };
      },
    });

    const before = registry.catalog().version;
    widgets = [widget("files"), widget("outline")];
    notify?.();

    expect(registry.catalog().version).toBeGreaterThan(before);
    expect(registry.catalog().widgets.map((entry) => entry.id)).toEqual(["files", "outline"]);
  });
});
