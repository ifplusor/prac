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
export * from "./view.js";
export * from "./viewGroup.js";
export * from "./frameGroups.js";
export * from "./frameBridge.js";
export * from "./public.js";
export * from "./surface.js";
export * from "./isolation.js";
