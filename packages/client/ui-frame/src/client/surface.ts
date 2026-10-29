/**
 * Surface contracts shared by the frame, windows and widget boards.
 *
 * A surface is the content root of a region: a window group on the stage, or a
 * widget board in a panel / dock. The frame owns the registry; window and widget
 * plugins register factories, so the frame never imports either plugin.
 *
 * @module prac-client-ui-frame/client/surface
 */

import {
  SurfaceRegistry as KitSurfaceRegistry,
  type Surface as KitSurface,
  type SurfaceCreateOptions as KitSurfaceCreateOptions,
  type SurfaceFactory as KitSurfaceFactory,
  type SurfaceKind as KitSurfaceKind,
} from "prac-ui-kit";
import type { FrameViewGroup } from "./frameGroups.js";

/** Product-defined surface kinds used by the frame. */
export type SurfaceKind = KitSurfaceKind;

/** One mounted surface with its frame group. */
export type Surface = KitSurface<FrameViewGroup>;

/** Creates one surface for a region. */
export type SurfaceFactory = KitSurfaceFactory<FrameViewGroup>;

/** Placement / host input supplied by the frame. */
export type SurfaceCreateOptions = KitSurfaceCreateOptions;

/** Socket registry specialised to the frame's group type. */
export class SurfaceRegistry extends KitSurfaceRegistry<FrameViewGroup> {}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracSurfaces: SurfaceRegistry;
  }
}
