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

import type {
  GroupBinding,
  MoveIntent,
  ViewDefinition,
  ViewGroupDefinition,
  ViewGroupResource,
  FrameViewGroup,
  ViewGroupRuntime,
  ViewHost,
  ViewResource,
  ViewRuntime,
} from "prac-client-ui-layout/client";

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

/** A concrete VS Code view-group resource. */
export interface VscodeViewGroup extends ViewGroupResource {
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

/** A concrete VS Code view resource. */
export interface VscodeView extends ViewResource {
  readonly spec: VscodeViewSpec;
}

/** The group runtime the adapter's factory must produce. */
export interface VscodeGroupRuntime extends FrameViewGroup {
  readonly binding?: GroupBinding;
  setBinding(binding: GroupBinding | undefined): void;
}

/** The adapter's factory for the core group runtime. */
export type VscodeGroupFactory = (id: string, mode: "stack" | "select") => VscodeGroupRuntime;

/** The adapter's factory for the core view runtime. */
export type VscodeViewFactory = (id: string) => ViewRuntime;

/** The adapter's factory for a view host. */
export type VscodeHostFactory = (
  view: VscodeView,
  options?: { readonly move?: MoveIntent },
) => ViewHost;

/** The adapter's optional group-binding factory. */
export type VscodeBindingFactory = (
  spec: VscodeViewGroupSpec,
  groupId: string,
) => GroupBinding | undefined;

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
export class VscodeGroupBinding implements GroupBinding {
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
export class VscodeViewHost implements ViewHost {
  constructor(
    readonly viewId: string,
    private readonly delegate: ViewHost,
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

/** `ViewGroupDefinition` for `vscode.prac/v1 ViewGroup`. */
export class VscodeViewGroupDefinition implements ViewGroupDefinition {
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

  materialize(decl: ViewGroupResource): ViewGroupRuntime {
    const spec = this.validate(decl.spec);
    return this.options.createGroup(
      decl.metadata.id,
      spec.groupKind === "editor" ? "select" : "stack",
    );
  }

  bindingFactory(decl: ViewGroupResource): GroupBinding | undefined {
    const group = decl as unknown as VscodeViewGroup;
    const spec = this.validate(group.spec);
    return this.options.createBinding?.(spec, group.metadata.id);
  }
}

/** `ViewDefinition` for `vscode.prac/v1 View`. */
export class VscodeViewDefinition implements ViewDefinition {
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

  materialize(decl: ViewResource): ViewRuntime {
    return this.options.createView(decl.metadata.id);
  }

  hostFactory(decl: ViewResource, options?: { readonly move?: MoveIntent }): ViewHost {
    const view = decl as unknown as VscodeView;
    return new VscodeViewHost(view.metadata.id, this.options.createHost(view, options));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
