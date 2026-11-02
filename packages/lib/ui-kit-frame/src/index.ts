/**
 * `prac-ui-kit-frame`: prac's frame layout engine as a library.
 *
 * The product model (region tree, view table, board roots), the generic
 * renderer and its chrome. It has **no DSH dependency and no plugin lifecycle**:
 * the frame plugin owns the DSH store, the slot catalogue and the
 * `SlotMap` / `Context` merges, and wires this engine to them.
 *
 * @module prac-ui-kit-frame
 */

export type { RegionInfo, ViewInfo } from "./catalogue.js";
export * from "./contract.js";
export * from "./catalogue.js";
export * from "./model.js";
export * from "./store.js";
export * from "./switching.js";
export * from "./workspace-scope.js";
export * from "./frameGroups.js";
export * from "./frameBridge.js";
export * from "./public.js";
export * from "./surface.js";
export * from "./frameState.js";
export * from "./layoutRoot.js";
export * from "./snapshot.js";
export * from "./isolation.js";
export * from "./windowModel.js";
export * from "./contentHosts.js";
export * from "./layoutRenderer.js";
export * from "./boardLayouts.js";
export * from "./chrome.js";
export * from "./chromeIntents.js";
export * from "./layoutTabs.js";
export * from "./layoutStack.js";
export * from "./layoutSash.js";
export * from "./layoutSashDrag.js";
export * from "./layoutStackDrag.js";
export * from "./layoutGrid.js";
export * from "./resizeController.js";
export * from "./layoutActions.js";
export * from "./layoutContainerBar.js";
export * from "./layoutIsolation.js";
export * from "./layoutContentHost.js";
export * from "./containerChrome.js";
export * from "./layoutDrop.js";
