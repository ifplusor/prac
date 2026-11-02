/**
 * Surface contracts.
 *
 * A surface is the content root bound to a geometry node: a window group on the
 * stage, a widget board in a panel / dock, or an opaque host. The frame owns the
 * registry; window and widget plugins register factories, so the frame never
 * imports either plugin.
 *
 * The content (`group`) and the host (`element`) are separate axes: content is
 * required, a mount point is optional. The renderer owns the DOM; a surface may
 * be model-only.
 *
 * @module prac-ui-kit-frame/surface
 */

import type { ContentMount, ContentRoot } from "prac-ui-kit-content";
import type { FrameWindowGroup } from "./frameGroups.js";

/** Product-defined surface kind; the frame never hard-codes window / widget kinds. */
export type SurfaceKind = string;

/** Content constraints a surface reports to the layout solver. */
export interface SurfaceConstraints {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  /** The surface wants the remaining space on its split axis. */
  readonly flex?: boolean;
}

/**
 * One mounted surface: a content root (content + kind) plus the optional host
 * binding. `group` is the concrete content the frame registry works with.
 */
export type Surface<TGroup = unknown> = Omit<ContentRoot<TGroup>, "content"> &
  ContentMount<HTMLElement> & {
    readonly group: TGroup;
  };

/** Inputs for creating one surface. */
export interface SurfaceCreateOptions {
  /** Stable id of the geometry node this surface fills. */
  readonly nodeId: string;
  /** Element the surface may mount into; model-only surfaces may ignore it. */
  readonly element?: HTMLElement;
}

/** Creates surfaces for one kind. */
export interface SurfaceFactory<TGroup = unknown> {
  create(options: SurfaceCreateOptions): Surface<TGroup>;
}

/** Registry of surface factories, keyed by product-defined kind. */
export class SurfaceRegistry<TGroup = unknown> {
  readonly #factories = new Map<SurfaceKind, SurfaceFactory<TGroup>>();

  register(kind: SurfaceKind, factory: SurfaceFactory<TGroup>): { dispose(): void } {
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

  create(kind: SurfaceKind, options: SurfaceCreateOptions): Surface<TGroup> {
    const factory = this.#factories.get(kind);
    if (!factory) throw new Error(`surface kind not registered: ${kind}`);
    return factory.create(options);
  }

  has(kind: SurfaceKind): boolean {
    return this.#factories.has(kind);
  }
}

/** The frame's surface: a content root whose group is a frame window group. */
export type FrameSurface = Surface<FrameWindowGroup>;
