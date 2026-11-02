/**
 * The kit's published type surface.
 *
 * Types only: this module exists so consumers can import prac's names without
 * restating them. Runtime constructors live beside it (the package barrel).
 *
 * @module prac-ui-kit-frame/public
 */

export type {
  Dir,
  GridNode,
  LayoutState,
  RegionChild,
  RegionNode,
  Side,
  SplitNode,
  ViewRecord,
} from "./contract.js";
export type { RegionInfo, ViewInfo } from "./catalogue.js";

/**
 * The slot key a prac surface registers its view into (`prac.view`).
 */
export type ViewSlotKey =
  | typeof import("./catalogue.js").VIEW_SLOT
  | typeof import("./catalogue.js").WINDOW_SLOT
  | typeof import("./catalogue.js").WIDGET_SLOT;

export type { WindowGroupLayoutBridge } from "./frameBridge.js";

export type { FrameGroup, FrameWindowGroup, GroupBarItem, WindowGroupHost } from "./frameGroups.js";
