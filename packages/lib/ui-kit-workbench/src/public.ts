/**
 * The kit's published type surface.
 *
 * Types only: this module exists so consumers can import prac's names without
 * restating them. Runtime constructors live beside it (the package barrel).
 *
 * @module prac-ui-kit-workbench/public
 */

export type {
  Dir,
  GridNode,
  LayoutState,
  RegionChild,
  RegionNode,
  Side,
  SplitNode,
  ItemRecord,
} from "./contract.js";

export type { WindowGroupLayoutBridge } from "./groupBridge.js";

export type { RegionBinding, GroupBarItem, WindowGroupBindings } from "./regionBindings.js";
export type { WindowGroup } from "./workbenchModel.js";
