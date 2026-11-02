import type { WindowGroup, WindowGroupBinding } from "prac-ui-kit-workbench";
/**
 * VS Code's concrete CRD-lite resources.
 *
 * The definitions carry the VS Code-specific categories and defaults, while the
 * materialized runtime is injected by the adapter. That keeps `core` free of
 * `vscode` imports and lets the same definitions be exercised without booting a
 * workbench.
 *
 * @module prac-client-vscode-host/client/resources
 */

/** The release handle a source hands a group for one view. */
export interface VscodeViewHandle {
  readonly id: string;
  release?(): void;
}

/** A source-owned hint passed when a view moves. */
export interface VscodeMoveIntent {
  readonly fromViewGroupId: string;
  readonly toViewGroupId: string;
  readonly reason: "user" | "layout" | "editor-split";
  readonly preserve?: "auto" | "state" | "never";
}

/** The source-owned view host boundary. */
export interface VscodeViewHostSurface {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly focusable: boolean;
}

/** The VS Code resource API group. */
export const VSCODE_API_VERSION = "vscode.prac/v1";

/** The two group shapes VS Code contributes. */
export type VscodeGroupKind = "container" | "editor";

/** Spec for one `VscodeViewGroup`. */
export interface VscodeViewGroupSpec extends Readonly<Record<string, unknown>> {
  readonly groupKind: VscodeGroupKind;
  readonly containerId?: string;
  readonly title?: string;
  readonly icon?: string;
  readonly order?: number;
  readonly hideIfEmpty?: boolean;
}

/** A concrete VS Code view-group declaration. */
export interface VscodeViewGroup {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly metadata: { readonly id: string };
  readonly spec: VscodeViewGroupSpec;
}

/** Spec for one `VscodeView`. */
export interface VscodeViewSpec extends Readonly<Record<string, unknown>> {
  /** Source-owned host capability; core never enumerates it. */
  readonly hostKind: string;
  /** The app's own view id, for diagnostics and catalogue pairing. */
  readonly viewId?: string;
  /** The source container the view was declared in. */
  readonly containerId?: string;
  readonly title?: string;
  readonly icon?: string;
  readonly paneHeader?: string;
}

/** A concrete VS Code view declaration. */
export interface VscodeView {
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly metadata: { readonly id: string };
  readonly spec: VscodeViewSpec;
}

/** The group runtime the adapter's factory must produce. */
export interface VscodeGroupRuntime extends WindowGroup {
  readonly binding?: WindowGroupBinding;
  setBinding(binding: WindowGroupBinding | undefined): void;
  add(view: VscodeViewHandle): void;
  remove(viewId: string): void;
  select(viewId: string | undefined): void;
  reorder(order: readonly string[]): void;
}

/** The adapter's factory for the core group runtime. */
export type VscodeGroupFactory = (
  id: string,
  mode: "stack" | "select",
  label?: string,
) => VscodeGroupRuntime;

/** The adapter's factory for the core view runtime. */
export type VscodeViewFactory = (id: string) => VscodeViewHandle;

/** The adapter's factory for a view host. */
export type VscodeHostFactory = (
  view: VscodeView,
  options?: { readonly move?: VscodeMoveIntent },
) => VscodeViewHostSurface;

/** The adapter's optional group-binding factory. */
export type VscodeBindingFactory = (
  spec: VscodeViewGroupSpec,
  groupId: string,
) => WindowGroupBinding | undefined;

/** Options for the VS Code view-group definition. */
export interface VscodeViewGroupDefinitionOptions {
  readonly createGroup: VscodeGroupFactory;
  readonly createBinding?: VscodeBindingFactory;
}

/** Options for the VS Code view definition. */
export interface VscodeViewDefinitionOptions {
  readonly createView: VscodeViewFactory;
  readonly createHost: VscodeHostFactory;
}

/** Runtime hooks behind one VS Code group binding. */
export interface VscodeGroupBindingRuntime {
  readonly containerId?: string;
  actions?(): readonly import("./public.js").PracVscodeAction[];
  runAction?(actionId: string): void;
  dispose?(): void;
}

/** A source-owned group binding for a VS Code group. */
export class VscodeGroupBinding implements WindowGroupBinding {
  #disposed = false;

  constructor(
    readonly groupId: string,
    readonly groupKind: VscodeGroupKind,
    private readonly runtime?: VscodeGroupBindingRuntime,
  ) {}

  /** The container this binding currently represents, if any. */
  get containerId(): string | undefined {
    return this.runtime?.containerId;
  }

  /** Container title actions the frame may render. */
  actions(): readonly import("./public.js").PracVscodeAction[] {
    return this.#disposed ? [] : (this.runtime?.actions?.() ?? []);
  }

  /** Run one container title action by id. */
  runAction(actionId: string): void {
    if (this.#disposed) return;
    this.runtime?.runAction?.(actionId);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.runtime?.dispose?.();
  }
}

/** A thin source-owned view host wrapper. */
export class VscodeViewHost implements VscodeViewHostSurface {
  constructor(
    readonly viewId: string,
    private readonly delegate: VscodeViewHostSurface,
  ) {}

  get focusable(): boolean {
    return this.delegate.focusable;
  }

  mount(element: HTMLElement): void {
    this.delegate.mount(element);
  }

  release(): void {
    this.delegate.release();
  }

  focus(): void {
    this.delegate.focus();
  }
}

/** The imperative source adapter behind a `VscodeViewHost`. */
export interface VscodeViewHostAdapter {
  mount(viewId: string, element: HTMLElement): void;
  release(viewId: string): void;
  focus?(viewId: string): void;
  readonly focusable?: boolean;
}

/**
 * Build a `VscodeViewHost` for one view resource.
 *
 * The app's view id comes from the source-owned spec when present; otherwise the
 * prac id convention is stripped. The adapter decides how to mount/release.
 */
export function createVscodeViewHost(
  view: VscodeView,
  adapter: VscodeViewHostAdapter,
): VscodeViewHost {
  const appViewId = view.spec.viewId ?? stripViewPrefix(view.metadata.id);
  return new VscodeViewHost(view.metadata.id, {
    mount: (element: HTMLElement) => adapter.mount(appViewId, element),
    release: () => adapter.release(appViewId),
    focus: () => adapter.focus?.(appViewId),
    focusable: adapter.focusable ?? true,
  });
}

function stripViewPrefix(id: string): string {
  return id.startsWith("vscode:view:") ? id.slice("vscode:view:".length) : id;
}

/** Typed factory for VS Code view groups. */
export class VscodeViewGroupDefinition {
  readonly apiVersion = VSCODE_API_VERSION;
  readonly kind = "ViewGroup";

  constructor(private readonly options: VscodeViewGroupDefinitionOptions) {}

  validate(spec: unknown): VscodeViewGroupSpec {
    if (!isRecord(spec)) throw new Error("VscodeViewGroup.spec must be an object");
    const groupKind = spec["groupKind"];
    if (groupKind !== "container" && groupKind !== "editor") {
      throw new Error("VscodeViewGroup.spec.groupKind must be container or editor");
    }
    return spec as unknown as VscodeViewGroupSpec;
  }

  materialize(decl: VscodeViewGroup): VscodeGroupRuntime {
    const spec = this.validate(decl.spec);
    return this.options.createGroup(
      decl.metadata.id,
      spec.groupKind === "editor" ? "select" : "stack",
      spec.title,
    );
  }

  bindingFactory(decl: VscodeViewGroup): WindowGroupBinding | undefined {
    const spec = this.validate(decl.spec);
    return this.options.createBinding?.(spec, decl.metadata.id);
  }
}

/** Typed factory for VS Code widgets. */
export class VscodeViewDefinition {
  readonly apiVersion = VSCODE_API_VERSION;
  readonly kind = "View";

  constructor(private readonly options: VscodeViewDefinitionOptions) {}

  validate(spec: unknown): VscodeViewSpec {
    if (!isRecord(spec)) throw new Error("VscodeView.spec must be an object");
    if (typeof spec["hostKind"] !== "string" || spec["hostKind"] === "") {
      throw new Error("VscodeView.spec.hostKind must be a non-empty string");
    }
    return spec as unknown as VscodeViewSpec;
  }

  materialize(decl: VscodeView): VscodeViewHandle {
    return this.options.createView(decl.metadata.id);
  }

  hostFactory(
    decl: VscodeView,
    options?: { readonly move?: VscodeMoveIntent },
  ): VscodeViewHostSurface {
    return new VscodeViewHost(decl.metadata.id, this.options.createHost(decl, options));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
