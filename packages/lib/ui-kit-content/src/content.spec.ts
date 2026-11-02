import { describe, expect, it } from "vite-plus/test";

import type {
  ContentGroup,
  ContentItem,
  ContentMount,
  ContentPlacement,
  ContentRoot,
} from "./content.js";
import type { LayoutState } from "./placement.js";
import { createSwitchingStore } from "./switching.js";
import type { LayoutStore } from "./store.js";
import type { LayoutNode } from "prac-ui-kit-layout";

interface Note {
  readonly text: string;
}

const item: ContentItem<Note> = { id: "note-1", content: { text: "hello" } };
const placement: ContentPlacement = {
  itemId: item.id,
  groupId: "tabs",
  order: 0,
  active: true,
  visible: true,
};
const group: ContentGroup<ContentItem<Note>> = {
  id: "tabs",
  state: { id: "tabs", mode: "stack", order: [item.id] },
  placements: [placement],
  items: [item],
  onDidChange: () => () => undefined,
  reorder: () => undefined,
  dispose: () => undefined,
};

describe("content protocols", () => {
  it("a content root does not assume a group", () => {
    const single: ContentRoot<ContentItem<Note>> = {
      kind: "item",
      content: item,
      dispose: () => undefined,
    };
    const grouped: ContentRoot<ContentGroup<ContentItem<Note>>> = {
      kind: "tabs",
      content: group,
      dispose: () => undefined,
    };
    const empty: ContentRoot = { kind: "empty", dispose: () => undefined };
    expect(single.content?.id).toBe("note-1");
    expect(grouped.content?.placements).toHaveLength(1);
    expect(empty.content).toBeUndefined();
  });

  it("mount is separate from the content model", () => {
    const host = { attached: false };
    const mount: ContentMount<typeof host> = {
      host,
      attach: () => {
        host.attached = true;
      },
      detach: () => {
        host.attached = false;
      },
    };
    mount.attach?.(host);
    expect(host.attached).toBe(true);
    mount.detach?.(host);
    expect(host.attached).toBe(false);
  });
});

const tree: LayoutNode = {
  type: "region",
  id: "root",
  size: 0,
  flex: true,
  collapsed: false,
  cachedSize: 0,
  min: 0,
};

function memory(panel: string | null): LayoutStore {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree,
    views: {},
    catalogueVersion: 0,
    activePanelId: panel,
  };
  return {
    get: () => state,
    subscribe: () => () => undefined,
    update: (updater) => {
      state = updater(state);
    },
    requestCloseView: () => undefined,
  };
}

describe("content store", () => {
  it("switches the active store generically", () => {
    const first = memory("first");
    const second = memory("second");
    const switching = createSwitchingStore(first);
    expect(switching.get().activePanelId).toBe("first");
    switching.switchTo(second);
    expect(switching.get().activePanelId).toBe("second");
    expect(switching.current()).toBe(second);
  });
});
