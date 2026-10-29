/**
 * Framework-agnostic surface contracts.
 *
 * A surface is the content root bound to a geometry node. It owns no layout and
 * no object model: the consumer decides what lives inside it.
 *
 * @module prac-ui-kit/surface
 */

/** Product-defined surface kind; the kit never hard-codes window / widget kinds. */
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

/** One mounted surface. */
export interface Surface<TGroup = unknown> {
  readonly kind: SurfaceKind;
  readonly group: TGroup;
  /** The geometry node's DOM root, when the surface is DOM-backed. */
  readonly element?: HTMLElement;
  /** Attach the node's content root. */
  attach?(element: HTMLElement): void;
  /** Detach the node's content root. */
  detach?(element: HTMLElement): void;
  /** Constraints used by the layout solver. */
  measure?(): SurfaceConstraints;
  dispose(): void;
}

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
