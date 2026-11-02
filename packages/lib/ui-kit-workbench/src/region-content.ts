/**
 * Region-content contracts.
 *
 * Region content is the content root bound to a geometry node: a window group on
 * the stage, a widget board in a panel / dock, or an opaque host. The frame owns the
 * registry; window and widget plugins register factories, so the frame never
 * imports either plugin.
 *
 * The content (`group`) and the host (`element`) are separate axes: content is
 * required, a mount point is optional. The renderer owns the DOM; region content
 * may be model-only.
 *
 * @module prac-ui-kit-workbench/region-content
 */

import type { ContentRoot } from "prac-ui-kit-content";

/** Product-defined content kind; the frame never hard-codes window / widget kinds. */
export type RegionContentKind = string;

/** Content constraints a region content reports to the layout solver. */
export interface RegionConstraints {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  /** The region content wants the remaining space on its split axis. */
  readonly flex?: boolean;
}

/**
 * One region content: a content root (content + kind) plus the optional host
 * binding. `group` is the concrete content the frame registry works with.
 */
export type RegionContent<TGroup = unknown> = Omit<ContentRoot<TGroup>, "content"> & {
  readonly group?: TGroup;
};

/** A region content whose content is a group. */
export type GroupRegionContent<TGroup = unknown> = RegionContent<TGroup> & {
  readonly group: TGroup;
};

/** Inputs for creating one region content. */
export interface RegionContentOptions {
  /** Stable id of the geometry node this content fills. */
  readonly nodeId: string;
  /** Element the content may mount into; model-only content may ignore it. */
  readonly element?: HTMLElement;
}

/** Creates region content for one kind. */
export interface RegionContentFactory<TGroup = unknown> {
  create(options: RegionContentOptions): RegionContent<TGroup>;
}

/** Registry of content factories, keyed by product-defined kind. */
export class RegionContentRegistry<TGroup = unknown> {
  readonly #factories = new Map<RegionContentKind, RegionContentFactory<TGroup>>();

  register(kind: RegionContentKind, factory: RegionContentFactory<TGroup>): { dispose(): void } {
    if (this.#factories.has(kind)) {
      throw new Error(`content kind already registered: ${kind}`);
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

  create(kind: RegionContentKind, options: RegionContentOptions): RegionContent<TGroup> {
    const factory = this.#factories.get(kind);
    if (!factory) throw new Error(`content kind not registered: ${kind}`);
    return factory.create(options);
  }

  has(kind: RegionContentKind): boolean {
    return this.#factories.has(kind);
  }
}
