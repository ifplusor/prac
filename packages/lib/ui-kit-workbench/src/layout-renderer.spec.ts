import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ReactNode } from "react";
import type { Box, LayoutNode, LayoutState, ItemRecord } from "./contract.js";
import {
  ChromeRegistry,
  LayoutRenderer,
  regionNode,
  type ChromeContext,
  type LayoutDecoration,
} from "prac-ui-kit-content";

/**
 * The generic renderer's contract.
 *
 * These are the facts the frame used to prove only in a live page: where the
 * active item goes, what a selector shows when its pick is empty, the order of
 * a split's sashes, and which chrome context each anchor receives. The frame's
 * gates still cover the pixels; this covers the shape the pixels are made of.
 */
const view = (region: string, order: number): ItemRecord => ({
  kind: "window",
  region,
  order,
  hidden: false,
});

const state = (tree: LayoutNode, items: Record<string, ItemRecord> = {}): LayoutState => ({
  viewportWidth: 1000,
  viewportHeight: 800,
  tree,
  items,
  catalogueVersion: 0,
  activePanelId: null,
});

const renderItem = (_record: ItemRecord, itemId: string): ReactNode =>
  createElement("span", { "data-item": itemId }, itemId);

const registry = (): ChromeRegistry<ItemRecord> => new ChromeRegistry<ItemRecord>();

const sizes = (entries: Record<string, Box>): ReadonlyMap<string, Box> =>
  new Map(Object.entries(entries));

describe("LayoutRenderer", () => {
  it("renders a region's front item inside the region box", () => {
    const tree = regionNode("r", 0, { flex: true });
    const chrome = registry();
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("r", 0), b: view("r", 1) }),
        sizes: sizes({ r: { width: 300, height: 200 } }),
        renderItem,
        chrome,
      }),
    );
    expect(markup).toContain('data-prac-region="r"');
    expect(markup).toContain('data-item="a"');
    expect(markup).not.toContain('data-item="b"');
  });

  it("renders the tab strip at region.tabs, above the item", () => {
    const tree = regionNode("r", 0, { flex: true, tabs: "multiple" });
    const chrome = registry();
    chrome.add({
      id: "tabs",
      anchor: "region.tabs",
      render: (ctx) => createElement("i", { "data-tabs": ctx.regionId }),
    });
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("r", 0), b: view("r", 1) }),
        renderItem,
        chrome,
      }),
    );
    expect(markup).toContain('data-tabs="r"');
    expect(markup.indexOf('data-tabs="r"')).toBeLessThan(markup.indexOf('data-item="a"'));
    expect(markup).not.toContain('data-item="b"');
  });

  it("shows the chosen child of a selector, not its first sibling", () => {
    const tree = regionNode("left", 0, {
      flex: true,
      active: "b",
      children: [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
    });
    const chrome = registry();
    const bars: ChromeContext<ItemRecord>[] = [];
    chrome.add({
      id: "bar",
      anchor: "region.header",
      render: (ctx) => {
        bars.push(ctx);
        return createElement("i", { "data-bar": ctx.regionId });
      },
    });
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { b: view("b", 0) }),
        renderItem,
        chrome,
      }),
    );
    expect(markup).toContain('data-prac-region="b"');
    expect(markup).not.toContain('data-prac-region="a"');
    expect(bars[0]?.itemId).toBe("b");
  });

  it("says a picked container is empty instead of falling back", () => {
    const tree = regionNode("left", 0, {
      flex: true,
      active: "b",
      children: [regionNode("a", 0, { flex: true }), regionNode("b", 100)],
    });
    const chrome = registry();
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("a", 0) }),
        renderItem,
        chrome,
        renderEmpty: (ctx) => createElement("em", { "data-empty": ctx.itemId }),
      }),
    );
    expect(markup).toContain('data-empty="b"');
    expect(markup).not.toContain('data-prac-region="a"');
  });

  it("draws a stack row as header + body, and a folded row as header only", () => {
    const tree: LayoutNode = {
      type: "split",
      id: "rows",
      dir: "column",
      children: [regionNode("row", 0, { entry: true })],
    };
    const chrome = registry();
    chrome.add({
      id: "header",
      anchor: "row.header",
      render: (ctx) => createElement("header", { "data-row": ctx.itemId }),
    });
    const options = {
      state: state(tree, { a: view("row", 0) }),
      sizes: sizes({ row: { width: 300, height: 260 } }),
      renderItem,
      chrome,
    };
    const open = renderToStaticMarkup(LayoutRenderer(options));
    expect(open).toContain('data-row="a"');
    expect(open).toContain("data-prac-stack-body");
    expect(open.indexOf('data-row="a"')).toBeLessThan(open.indexOf("data-prac-stack-body"));

    const foldedRow = { ...regionNode("row", 0, { entry: true }), collapsed: true };
    const folded = renderToStaticMarkup(
      LayoutRenderer({
        ...options,
        state: state(
          { type: "split", id: "rows", dir: "column", children: [foldedRow] },
          {
            a: view("row", 0),
          },
        ),
      }),
    );
    expect(folded).toContain('data-row="a"');
    expect(folded).not.toContain("data-prac-stack-body");
  });

  it("uses an overlay instead of a header when the item brings its own", () => {
    const tree: LayoutNode = {
      type: "split",
      id: "rows",
      dir: "column",
      children: [regionNode("row", 0, { entry: true })],
    };
    const chrome = registry();
    chrome.add({
      id: "header",
      anchor: "row.header",
      render: (ctx) => createElement("header", { "data-row": ctx.itemId }),
    });
    chrome.add({
      id: "overlay",
      anchor: "region.overlay",
      render: (ctx) => createElement("i", { "data-overlay": ctx.itemId }),
    });
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("row", 0) }),
        sizes: sizes({ row: { width: 300, height: 260 } }),
        renderItem,
        chrome,
        ownHeader: () => true,
      }),
    );
    expect(markup).toContain("data-prac-stack-body");
    expect(markup).toContain('data-overlay="a"');
    expect(markup).not.toContain("data-row=");
  });

  it("places a sash between split children with its boundary context", () => {
    const tree: LayoutNode = {
      type: "split",
      id: "root",
      dir: "row",
      children: [regionNode("a", 100, { flex: false }), regionNode("b", 200, { flex: false })],
    };
    const chrome = registry();
    const seen: ChromeContext<ItemRecord>[] = [];
    chrome.add({
      id: "sash",
      anchor: "split.sash",
      render: (ctx) => {
        seen.push(ctx);
        return createElement("s", {
          "data-sash": `${ctx.beforeId}->${ctx.afterId}`,
          "data-index": ctx.index,
          "data-offset": ctx.offset,
        });
      },
    });
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("a", 0), b: view("b", 0) }),
        sizes: sizes({
          root: { width: 300, height: 800 },
          a: { width: 100, height: 800 },
          b: { width: 200, height: 800 },
        }),
        renderItem,
        chrome,
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.index).toBe(1);
    expect(seen[0]?.offset).toBe(100);
    expect(seen[0]?.beforeId).toBe("a");
    expect(seen[0]?.afterId).toBe("b");
    expect(markup).toContain('data-sash="a-&gt;b"');
    expect(markup.indexOf('data-prac-region="a"')).toBeLessThan(markup.indexOf("data-sash"));
    expect(markup.indexOf("data-sash")).toBeLessThan(markup.indexOf('data-prac-region="b"'));
  });

  it("places grid cells and gives cell/track chrome their geometry", () => {
    const tree: LayoutNode = {
      type: "grid",
      id: "g",
      rows: 1,
      columns: 2,
      children: [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })],
    };
    const chrome = registry();
    const cells: ChromeContext<ItemRecord>[] = [];
    const tracks: ChromeContext<ItemRecord>[] = [];
    chrome.add({
      id: "cell",
      anchor: "grid.cell",
      render: (ctx) => {
        cells.push(ctx);
        return createElement("i", { "data-cell": ctx.itemId });
      },
    });
    chrome.add({
      id: "track",
      anchor: "grid.track",
      render: (ctx) => {
        tracks.push(ctx);
        return createElement("t", { "data-track": ctx.track, "data-index": ctx.index });
      },
    });
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("a", 0), b: view("b", 0) }),
        sizes: sizes({
          g: { width: 600, height: 400 },
          a: { width: 300, height: 400 },
          b: { width: 300, height: 400 },
        }),
        renderItem,
        chrome,
      }),
    );
    expect(cells).toHaveLength(2);
    expect(cells[0]?.placement).toEqual({ row: 0, column: 0 });
    expect(cells[1]?.placement).toEqual({ row: 0, column: 1 });
    expect(cells[0]?.shape).toEqual({ rows: 1, columns: 2 });
    expect(cells[0]?.cellCount).toBe(2);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.track).toBe("column");
    expect(tracks[0]?.index).toBe(0);
    expect(markup).toContain('data-cell="a"');
    expect(markup).toContain('data-cell="b"');
    expect(markup).toContain('data-track="column"');
  });

  it("lets a container decorate a node without owning its geometry", () => {
    const tree = regionNode("r", 0, { flex: true });
    const decoration: LayoutDecoration = {
      attrs: { "data-prac-region-content": "widget-board" },
      style: { outline: "1px solid red" },
    };
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: state(tree, { a: view("r", 0) }),
        renderItem,
        decorate: () => decoration,
      }),
    );
    expect(markup).toContain('data-prac-region-content="widget-board"');
    expect(markup).toContain("outline:1px solid red");
  });
});
