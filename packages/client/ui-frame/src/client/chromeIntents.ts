/**
 * The default `LayoutIntents` over one frame store.
 *
 * Chrome uses these instead of writing layout state directly: activation, close,
 * fold, resize and reorder all go through the same model functions as the frame
 * gestures.
 *
 * @module prac-client-ui-frame/client/chromeIntents
 */
import type { LayoutStore } from "./store.js";
import type { LayoutIntents } from "./chrome.js";
import {
  findNode,
  reorderTab,
  resizeBoundary,
  setCollapsed,
  setEntryFolded,
  setFront,
} from "./model.js";

/** Build the default intents for one store. */
export function createLayoutIntents(store: LayoutStore): LayoutIntents {
  return {
    activate(itemId: string): void {
      store.update((state) => setFront(state, itemId));
    },
    close(itemId: string): void {
      store.requestCloseView(itemId);
    },
    fold(nodeId: string, folded: boolean): void {
      store.update((state) => {
        const node = findNode(state.tree, nodeId);
        if (node?.type !== "region") return state;
        return node.entry === true
          ? setEntryFolded(state, nodeId, folded, node.cachedSize)
          : setCollapsed(state, nodeId, folded, node.cachedSize);
      });
    },
    resize(splitId: string, index: number, delta: number): void {
      store.update((state) => resizeBoundary(state, splitId, index, delta));
    },
    reorder(anchor: string, itemId: string, before?: string): void {
      if (before === undefined) return;
      store.update((state) => reorderTab(state, anchor, itemId, before));
    },
  };
}
