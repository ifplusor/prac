import type { WidgetRecord, LayoutState } from "prac-ui-kit-workbench";
import { LayoutRenderer, createLayoutIntents, gridNode, regionNode } from "prac-ui-kit-content";
/**
 * The board's chrome is a container over the generic parts: every anchor is
 * populated, mutations write the board's own state, and widget actions come
 * through the container's slot face.
 */
import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BoardContent } from "./board-content.js";
import { createBoardChrome } from "./board-chrome.js";
import { createBoardStore } from "./board-store.js";

const widget = (region: string, order: number, extra: Partial<WidgetRecord> = {}): WidgetRecord =>
  ({ kind: "widget", region, order, hidden: false, ...extra }) as WidgetRecord;

const state = (tree: LayoutState<WidgetRecord>["tree"], items: Record<string, WidgetRecord>) => ({
  viewportWidth: 1000,
  viewportHeight: 700,
  tree,
  items,
  catalogueVersion: 0,
  activePanelId: null,
});

const renderItem = (_record: WidgetRecord, widgetId: string): ReactNode =>
  createElement("span", { "data-widget": widgetId }, widgetId);

describe("createBoardChrome", () => {
  it("renders stack row headers for a board's rows", () => {
    const content = new BoardContent("board");
    content.placeWidget("vscode:view:outline");
    content.placeWidget("vscode:view:timeline");
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: content.state,
        renderItem,
        chrome: createBoardChrome(content),
      }),
    );
    expect(markup).toContain("data-prac-stack-header");
    expect(markup).toContain('data-prac-stack-toggle="vscode:view:outline"');
    expect(markup).toContain('data-widget="vscode:view:timeline"');
  });

  it("renders the tab strip with widget actions from the slot face", () => {
    const content = new BoardContent("board");
    const slots: string[] = [];
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: {
          ...content.state,
          tree: { ...regionNode("board", 0), tabs: "multiple" as const },
          items: {
            w1: widget("board", 0),
            w2: widget("board", 1),
          },
        },
        renderItem,
        chrome: createBoardChrome(content),
        slotFace: (slot) => {
          slots.push(slot);
          return createElement("span", { "data-slot": slot });
        },
      }),
    );
    expect(markup).toContain("data-prac-tab-strip");
    expect(markup).toContain('data-prac-tab="w1"');
    expect(slots).toContain("prac.widgetActions");
  });

  it("renders a draggable sash between the board's regions", () => {
    const content = new BoardContent("board");
    content.placeWidget("a");
    content.placeWidget("b");
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: content.state,
        renderItem,
        chrome: createBoardChrome(content),
      }),
    );
    expect(markup).toContain("data-prac-sash=");
    expect(markup).toContain("data-prac-stack-sash-state");
  });

  it("renders grid handles for a board root with a grid", () => {
    const content = new BoardContent("board");
    const grid = state(
      gridNode("g", 1, 2, [regionNode("a", 0, { flex: true }), regionNode("b", 0, { flex: true })]),
      { w1: widget("a", 0), w2: widget("b", 0) },
    );
    const markup = renderToStaticMarkup(
      LayoutRenderer({
        state: grid,
        renderItem,
        chrome: createBoardChrome(content),
      }),
    );
    expect(markup).toContain("data-prac-grid-handle");
    expect(markup).toContain("data-prac-grid-merge");
    expect(markup).toContain("data-prac-grid-track");
  });
});

describe("createBoardStore", () => {
  it("drives the shared intents from the board's own state", () => {
    const content = new BoardContent("board");
    content.placeWidget("a");
    content.placeWidget("b");
    const store = createBoardStore(content);
    const intents = createLayoutIntents(store);
    intents.activate("b");
    expect(content.get().items["b"]?.front).toBe(true);
    intents.close("b");
    expect(content.get().items["b"]).toBeUndefined();
  });
});
