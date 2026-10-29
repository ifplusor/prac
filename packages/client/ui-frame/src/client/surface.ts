/**
 * Surface contracts shared by the frame, windows and widget boards.
 *
 * A surface is the content root of a region: a window group on the stage, or a
 * widget board in a panel / dock. The frame owns the registry; window and widget
 * plugins register factories, so the frame never imports either plugin.
 *
 * @module prac-client-ui-frame/client/surface
 */

import type {
  Surface as KitSurface,
  SurfaceCreateOptions as KitSurfaceCreateOptions,
  SurfaceFactory as KitSurfaceFactory,
  SurfaceKind as KitSurfaceKind,
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

/** Registry of surface factories, keyed by kind. */
export class SurfaceRegistry {
  readonly #factories = new Map<SurfaceKind, SurfaceFactory>();

  register(kind: SurfaceKind, factory: SurfaceFactory): { dispose(): void } {
    if (this.#factories.has(kind)) {
      throw new Error(`surface kind already registered: ${kind}`);
    }
    this.#factories.set(kind, factory);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.#factories.get(kind) === factory) this.#factories.delete(kind);
      },
    };
  }

  create(kind: SurfaceKind, options: SurfaceCreateOptions): Surface {
    const factory = this.#factories.get(kind);
    if (!factory) throw new Error(`surface kind not registered: ${kind}`);
    return factory.create(options);
  }

  has(kind: SurfaceKind): boolean {
    return this.#factories.has(kind);
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracSurfaces: SurfaceRegistry;
  }
}
