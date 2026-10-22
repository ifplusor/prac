/**
 * CRD-lite for prac's UI resources.
 *
 * The core borrows only the **type / instance** split from Kubernetes:
 * a `Definition` describes a kind, a `Resource` is an instance, and a
 * materializer turns the instance into a runtime. It deliberately does not
 * implement a controller framework, a status subresource, finalizers, or
 * multi-version conversion.
 *
 * Categories are kept apart on purpose: a `ViewGroupDefinition` never accepts a
 * `ViewResource`, and vice versa. Category is expressed by the interface and the
 * registry, not by a `category` field on the resource.
 *
 * @module prac-client-ui-layout/client/resource
 */

/** A resource instance envelope shared by both categories. */
export interface ResourceEnvelope<TSpec> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: ResourceMetadata;
  readonly spec: TSpec;
}

/** Identity and labels of one resource. */
export interface ResourceMetadata {
  readonly id: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

/** The group category's core spec. Source-specific fields stay opaque here. */
export type ViewGroupSpec = Readonly<Record<string, unknown>>;

/** The view category's core spec. Source-specific fields stay opaque here. */
export type ViewSpec = Readonly<Record<string, unknown>>;

/** A group resource. Concrete adaptors extend this with their own spec type. */
export interface ViewGroupResource extends ResourceEnvelope<ViewGroupSpec> {}

/** A view resource. Concrete adaptors extend this with their own spec type. */
export interface ViewResource extends ResourceEnvelope<ViewSpec> {}

/** A materialized group runtime. */
export interface ViewGroupRuntime {
  dispose(): void;
}

/** A materialized view runtime. */
export interface ViewRuntime {
  dispose(): void;
}

/** A source-specific group runtime binding. */
export interface GroupBinding {
  dispose(): void;
}

/** A per-view runtime boundary. */
export interface ViewHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly focusable: boolean;
}

/** A source-owned hint passed when a view moves between view groups. */
export interface MoveIntent {
  readonly fromViewGroupId: string;
  readonly toViewGroupId: string;
  readonly reason: "user" | "layout" | "editor-split";
  readonly preserve?: "auto" | "state" | "never";
}

/** A diagnostic reported by a definition or materializer. */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly ownerId?: string;
  readonly resourceId?: string;
  readonly cause?: unknown;
}

/** Runtime-only phase of one materialized resource. This is not a CR status. */
export type ResourcePhase =
  | "declared"
  | "waiting"
  | "materializing"
  | "ready"
  | "failed"
  | "releasing"
  | "released";

/**
 * A sentinel a definition can return when it has registered a wait through
 * {@link MaterializeContext.whenReady} and is not ready yet.
 */
export const MATERIALIZE_PENDING = Symbol("prac.materialize.pending");

/** The result of a definition's `materialize` call. */
export type MaterializeOutcome<T> = T | Promise<T> | typeof MATERIALIZE_PENDING;

/** Context passed to a definition's `materialize`. */
export interface MaterializeContext {
  /** The adapter/source scope that owns the resource. Not stored in the CR. */
  readonly ownerId: string;
  /** Monotonic generation for this resource id. */
  readonly generation: number;
  /** Report a diagnostic without throwing into the frame. */
  report(diagnostic: Diagnostic): void;
  /** Ask the materializer to retry when another resource becomes ready. */
  whenReady(resourceId: string, retry: () => void): void;
}

/** A disposable returned by definition registration. */
export interface ResourceDisposable {
  dispose(): void;
}

/**
 * The minimal shape shared by category definitions.
 *
 * This is an implementation helper for the materializer, not a public
 * "one resource definition to rule them all" category.
 */
export interface MaterializerDefinition<TSpec, TValue extends { dispose(): void }> {
  readonly apiVersion: string;
  readonly kind: string;
  validate(spec: unknown): TSpec;
  default?(spec: unknown): TSpec;
  dependencies?(decl: ResourceEnvelope<TSpec>): readonly string[];
  materialize(decl: ResourceEnvelope<TSpec>, ctx: MaterializeContext): MaterializeOutcome<TValue>;
}

/** Definition for a view group kind. */
export interface ViewGroupDefinition extends MaterializerDefinition<
  ViewGroupSpec,
  ViewGroupRuntime
> {
  bindingFactory?(decl: ViewGroupResource): GroupBinding | undefined;
}

/** Definition for a view kind. */
export interface ViewDefinition extends MaterializerDefinition<ViewSpec, ViewRuntime> {
  hostFactory(decl: ViewResource, options?: { readonly move?: MoveIntent }): ViewHost;
}

/** Registry of definitions for one category. */
export class DefinitionRegistry<D extends { readonly apiVersion: string; readonly kind: string }> {
  readonly #definitions = new Map<string, D>();

  /** Register a definition; duplicate apiVersion/kind is rejected. */
  register(definition: D): ResourceDisposable {
    const key = definitionKey(definition.apiVersion, definition.kind);
    if (this.#definitions.has(key)) {
      throw new Error(`definition already registered: ${definition.apiVersion}/${definition.kind}`);
    }
    this.#definitions.set(key, definition);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.#definitions.get(key) === definition) this.#definitions.delete(key);
      },
    };
  }

  /** Look up a definition, or `undefined` when this category does not know it. */
  lookup(apiVersion: string, kind: string): D | undefined {
    return this.#definitions.get(definitionKey(apiVersion, kind));
  }
}

/** ViewGroup category registry. */
export class ViewGroupDefinitionRegistry extends DefinitionRegistry<ViewGroupDefinition> {}

/** View category registry. */
export class ViewDefinitionRegistry extends DefinitionRegistry<ViewDefinition> {}

/** One materialized resource record. */
export class MaterializedResource<TValue extends { dispose(): void }> {
  phase: ResourcePhase = "declared";
  value: TValue | undefined;
  error: Diagnostic | undefined;
  #disposed = false;

  constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly generation: number,
  ) {}

  /** Release the materialized runtime once; repeated calls are no-ops. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.phase = "releasing";
    try {
      this.value?.dispose();
    } finally {
      this.value = undefined;
      this.phase = "released";
    }
  }
}

/**
 * Shared runtime state for all categories.
 *
 * Group and view materializers share one store so a view can depend on a group
 * id materialized by the other category. The store owns runtime records and
 * dependency waiters; it is still not a controller or a CR status.
 */
export class ResourceStateStore {
  readonly #records = new Map<string, MaterializedResource<{ dispose(): void }>>();
  readonly #waiters = new Map<string, Set<() => void>>();

  get(id: string): MaterializedResource<{ dispose(): void }> | undefined {
    return this.#records.get(id);
  }

  set(id: string, record: MaterializedResource<{ dispose(): void }>): void {
    this.#records.set(id, record);
  }

  delete(id: string): void {
    this.#records.delete(id);
  }

  values(): readonly MaterializedResource<{ dispose(): void }>[] {
    return [...this.#records.values()];
  }

  whenReady(resourceId: string, retry: () => void): void {
    let set = this.#waiters.get(resourceId);
    if (!set) {
      set = new Set();
      this.#waiters.set(resourceId, set);
    }
    set.add(retry);
  }

  notify(resourceId: string): void {
    const set = this.#waiters.get(resourceId);
    if (!set) return;
    this.#waiters.delete(resourceId);
    for (const retry of set) retry();
  }
}

/**
 * Materializer for one category.
 *
 * It owns resource records and the dependency waiters; it does not own the
 * source runtime (`ownerId` is the adapter's scope) and does not run a
 * controller loop.
 */
export class ResourceMaterializer<
  TSpec,
  TValue extends { dispose(): void },
  TDefinition extends MaterializerDefinition<TSpec, TValue>,
> {
  readonly #onDiagnostic: (diagnostic: Diagnostic) => void;

  constructor(
    private readonly registry: DefinitionRegistry<TDefinition>,
    onDiagnostic?: (diagnostic: Diagnostic) => void,
    private readonly states: ResourceStateStore = new ResourceStateStore(),
  ) {
    this.#onDiagnostic = onDiagnostic ?? (() => {});
  }

  /** Look up a record by resource id. */
  get(id: string): MaterializedResource<TValue> | undefined {
    return this.states.get(id) as MaterializedResource<TValue> | undefined;
  }

  /**
   * Materialize one resource.
   *
   * The returned record is the authoritative runtime state; it can be `waiting`
   * when a dependency is missing. Failures are recorded as `failed` and reported
   * as diagnostics instead of being thrown into the frame.
   */
  async materialize(
    decl: ResourceEnvelope<TSpec>,
    ownerId: string,
  ): Promise<MaterializedResource<TValue>> {
    const id = decl.metadata.id;
    const previous = this.get(id);
    if (previous && (previous.phase === "ready" || previous.phase === "materializing")) {
      return previous;
    }

    const generation = (previous?.generation ?? 0) + 1;
    const record = new MaterializedResource<TValue>(id, ownerId, generation);
    this.states.set(id, record);

    const definition = this.registry.lookup(decl.apiVersion, decl.kind);
    if (!definition) {
      return this.#fail(
        record,
        "unknown-definition",
        `no definition for ${decl.apiVersion}/${decl.kind}`,
      );
    }

    const dependencies = definition.dependencies?.(decl) ?? [];
    const missing = dependencies.filter(
      (dependency) => this.states.get(dependency)?.phase !== "ready",
    );
    if (missing.length > 0) {
      record.phase = "waiting";
      for (const dependency of missing) {
        this.states.whenReady(dependency, () => {
          void this.materialize(decl, ownerId);
        });
      }
      return record;
    }

    record.phase = "materializing";
    const context: MaterializeContext = {
      ownerId,
      generation,
      report: (diagnostic) => this.#report(diagnostic),
      whenReady: (resourceId, retry) => this.states.whenReady(resourceId, retry),
    };

    try {
      const validated = definition.validate(decl.spec);
      const normalized = definition.default?.(validated) ?? validated;
      const normalizedDecl = { ...decl, spec: normalized };
      const outcome = await definition.materialize(normalizedDecl, context);

      if (record.generation !== generation || !this.#isActive(record)) return record;
      if (outcome === MATERIALIZE_PENDING) {
        record.phase = "waiting";
        return record;
      }

      record.value = outcome;
      record.phase = "ready";
      this.states.notify(id);
      return record;
    } catch (cause) {
      return this.#fail(record, "materialize-failed", `materialize failed for ${id}`, cause);
    }
  }

  /** Dispose every resource created by one adapter/source scope. */
  releaseOwner(ownerId: string): void {
    const owned = [...this.states.values()]
      .filter((record) => record.ownerId === ownerId)
      .reverse();
    for (const record of owned) {
      record.dispose();
      this.states.delete(record.id);
    }
  }

  /** Dispose one resource by id. */
  dispose(id: string): void {
    const record = this.states.get(id) as MaterializedResource<TValue> | undefined;
    if (!record) return;
    record.dispose();
    this.states.delete(id);
  }

  #fail(
    record: MaterializedResource<TValue>,
    code: string,
    message: string,
    cause?: unknown,
  ): MaterializedResource<TValue> {
    const diagnostic: Diagnostic = {
      code,
      message,
      ownerId: record.ownerId,
      resourceId: record.id,
      cause,
    };
    record.error = diagnostic;
    record.phase = "failed";
    this.#report(diagnostic);
    return record;
  }

  #report(diagnostic: Diagnostic): void {
    this.#onDiagnostic(diagnostic);
  }

  #isActive(record: MaterializedResource<TValue>): boolean {
    return record.phase === "materializing";
  }
}

/** Materializer for view group resources. */
export class ViewGroupMaterializer extends ResourceMaterializer<
  ViewGroupSpec,
  ViewGroupRuntime,
  ViewGroupDefinition
> {
  constructor(
    registry: ViewGroupDefinitionRegistry,
    onDiagnostic?: (diagnostic: Diagnostic) => void,
    states?: ResourceStateStore,
  ) {
    super(registry, onDiagnostic, states);
  }
}

/** Materializer for view resources. */
export class ViewMaterializer extends ResourceMaterializer<ViewSpec, ViewRuntime, ViewDefinition> {
  constructor(
    registry: ViewDefinitionRegistry,
    onDiagnostic?: (diagnostic: Diagnostic) => void,
    states?: ResourceStateStore,
  ) {
    super(registry, onDiagnostic, states);
  }
}

function definitionKey(apiVersion: string, kind: string): string {
  return `${apiVersion}\u0000${kind}`;
}
