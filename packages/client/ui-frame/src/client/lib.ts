/**
 * Library surface of the frame plugin.
 *
 * Types and pure model code for consumers that must not import the plugin
 * lifecycle. Runtime access to the frame is through `ctx.pracFrame`.
 *
 * @module prac-client-ui-frame/lib
 */

export type { PracLayoutFace, PracSpacesFace, SpaceInfo } from "./contract.js";
export type { RegionInfo, ViewInfo } from "./catalogue.js";
export * from "./contracts.js";
export * from "./contract.js";
export * from "./catalogue.js";
export * from "./model.js";
export * from "./store.js";
export * from "./switching.js";
export * from "./workspace-scope.js";
export * from "./view.js";
export * from "./frameGroups.js";
export * from "./frameBridge.js";
export * from "./public.js";
export * from "./surface.js";
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
export * from "./layoutItem.js";
export * from "./containerChrome.js";
export * from "./layoutDrop.js";
