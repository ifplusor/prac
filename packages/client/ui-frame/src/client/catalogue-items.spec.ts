import { describe, expect, it } from "vite-plus/test";

import type { LayoutState } from "prac-ui-kit-workbench";

import { listCatalogueItems } from "./catalogue-items.js";

/** A layout state with the given items; only `items` matters here. */
const stateWith = (items: LayoutState["items"] = {}): LayoutState =>
  ({ items, tree: {} }) as unknown as LayoutState;

type KindMap = Readonly<Record<string, "window" | "widget">>;

const kinds = (map: KindMap) => (id: string) => map[id];

describe("listCatalogueItems", () => {
  it("unions slot declarations and admitted app windows without duplicates", () => {
    const items = listCatalogueItems(stateWith(), ["a", "b"], ["b", "c"], kinds({}));
    expect(items.map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("reports a placed item with its placement and record kind", () => {
    const items = listCatalogueItems(
      stateWith({
        a: { region: "center", hidden: false, order: 2, kind: "window" },
        b: { region: "left", hidden: true, order: 1, kind: "widget" },
      }),
      ["a", "b"],
      [],
      kinds({ a: "widget", b: "widget" }),
    );
    expect(items).toEqual([
      { id: "a", region: "center", hidden: false, order: 2, kind: "window" },
      { id: "b", region: "left", hidden: true, order: 1, kind: "widget" },
    ]);
  });

  it("reports an unplaced item as hidden, with no region or order", () => {
    const items = listCatalogueItems(stateWith(), ["a"], ["w"], kinds({ a: "widget" }));
    expect(items).toEqual([
      { id: "a", region: null, hidden: true, order: null, kind: "widget" },
      { id: "w", region: null, hidden: true, order: null, kind: "window" },
    ]);
  });

  it("classifies an unplaced item by its declaration, defaulting to window", () => {
    const items = listCatalogueItems(stateWith(), [], ["w"], kinds({}));
    expect(items[0]?.kind).toBe("window");
  });

  it("keeps an admitted window that the arrangement has not placed yet", () => {
    // The editor admits a file before the arrangement has placed it; dropping it
    // here is how a split's second view went missing from the catalogue.
    const items = listCatalogueItems(stateWith(), [], ["vscode:file:p1:x"], kinds({}));
    expect(items.map((item) => item.id)).toEqual(["vscode:file:p1:x"]);
    expect(items[0]?.region).toBeNull();
  });
});
