/**
 * The client half's published type surface.
 *
 * Types only: this module exists so consumers can import prac's names without
 * restating them. Runtime constructors live in `client/index.ts`.
 *
 * @module prac-client-ui-frame/client/public
 */

export type {
  Dir,
  GridNode,
  LayoutState,
  LayoutFace,
  PracLayoutFace,
  PracSpacesFace,
  SpaceInfo,
  RegionChild,
  RegionNode,
  RoleBindings,
  Side,
  SplitNode,
  ViewRecord,
} from "./contract.js";
export type { RegionInfo, ViewInfo } from "./catalogue.js";

/**
 * The slot key a prac surface registers its view into (`prac.view`).
 */
export type ViewSlotKey = typeof import("./catalogue.js").VIEW_SLOT;

// Runtime contracts the adapters may name.
export type {
  GroupAction,
  GroupActionBinding,
  GroupBinding,
  MoveIntent,
  ViewGroupRuntime,
  ViewHost,
  ViewRuntime,
} from "./contracts.js";
export type { FrameView, View } from "./view.js";
export type { ViewGroup, ViewGroupMode, ViewGroupPlacement, ViewGroupState } from "./viewGroup.js";
export type { MoveViewRequest } from "./move.js";

export type { ViewGroupLayoutBridge } from "./frameBridge.js";

export type { FrameGroup, FrameViewGroup, GroupBarItem, ViewGroupHost } from "./frameGroups.js";
