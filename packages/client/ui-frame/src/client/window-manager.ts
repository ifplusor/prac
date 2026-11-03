import type { ReactNode } from "react";
import type {
  ApplicationRegistry,
  GroupBarItem,
  GroupRegionContent,
  RegionBinding,
  WindowGroup,
} from "prac-ui-kit-workbench";
/**
 * The window manager: who owns a window, and which group it belongs to.
 *
 * A window is an instance opened by an app; **membership is not the opener's
 * decision**. This service is the one place that answers "which group holds this
 * window" and performs the membership operations (open / close / activate /
 * move). Group runtimes keep their own order and active state; the manager reads
 * them as the authority and never keeps a second copy.
 *
 * The frame's region projection stays in `WindowGroupBindings`; the manager owns
 * that binding and delegates to it, so hosts keep registering groups and reading
 * their region content through the same surface they used before.
 *
 * @module prac-client-ui-frame/client/window-manager
 */

/** One open window, as the manager reports it. */
export interface PracWindowInfo {
  readonly id: string;
  readonly appId: string;
  readonly groupId: string;
}

/** One window an app asks the manager to admit. */
export interface AdmitWindowOptions {
  /** The window instance id (global: `vscode:file:…`, `dsh:main:…`). */
  readonly windowId: string;
  /** The window title the chrome shows until the app provides one. */
  readonly title?: string;
  /** Which group takes it; otherwise the manager picks the group bound in `region`. */
  readonly groupId?: string;
  /** The region the window is expected in, when no group is named. */
  readonly region?: string;
}

/** The handle a source hands its group for one window. */
export interface WindowRuntimeHandle {
  readonly id: string;
  release?(): void;
}

/**
 * What the manager needs from one group runtime.
 *
 * Both implementations satisfy it today: the VS Code group runtime
 * (`vscode-host`) and the frame's window-group adapter.
 */
export interface WindowGroupRuntime {
  readonly id: string;
  readonly state: { readonly order: readonly string[]; readonly active?: string };
  add(window: WindowRuntimeHandle): void;
  remove(windowId: string): void;
  select(windowId: string | undefined): void;
}

/** The frame projection the manager delegates to (satisfied by `WindowGroupBindings`). */
export interface WindowGroupBindingsPort {
  register(
    group: WindowGroup,
    regionId: string,
    content?: GroupRegionContent<WindowGroup>,
  ): RegionBinding;
  registerContent(content: GroupRegionContent<WindowGroup>, regionId: string): RegionBinding;
  barItems(regionId: string): readonly GroupBarItem[];
  contentFor(regionId: string): GroupRegionContent<WindowGroup> | undefined;
  get(groupId: string): RegionBinding | undefined;
  unregister(groupId: string): void;
  dispose(): void;
}

/** The window manager: group registry plus membership decisions. */
export class WindowManager {
  readonly #runtimes = new Map<string, WindowGroupRuntime>();
  /** The source's handle per window, kept for a move (the group owns order only). */
  readonly #handles = new Map<string, WindowRuntimeHandle>();
  /** The app that opened each window, for single-instance reuse. */
  readonly #appOf = new Map<string, string>();
  /** The title each app gave its window. */
  readonly #titles = new Map<string, string>();

  constructor(
    private readonly bindings: WindowGroupBindingsPort,
    private readonly apps: ApplicationRegistry,
  ) {}

  /**
   * Register a group runtime in a frame region.
   *
   * @param runtime - the group runtime that owns order / active for its windows.
   * @param regionId - the region the group is projected into.
   * @param content - an existing region content, when the group is already hosted.
   * @returns the frame binding.
   */
  register(
    runtime: WindowGroupRuntime,
    regionId: string,
    content?: GroupRegionContent<WindowGroup>,
  ): RegionBinding {
    if (this.#runtimes.has(runtime.id)) {
      throw new Error(`window manager: group already registered: ${runtime.id}`);
    }
    const binding = this.bindings.register(runtime as unknown as WindowGroup, regionId, content);
    this.#runtimes.set(runtime.id, runtime);
    return binding;
  }

  /**
   * Register a region content's group (the board-window path).
   *
   * The group is projected into the region but is not yet a membership runtime:
   * the board group model exposes `openWindow` / `closeWindow` / `activateWindow`,
   * not the `add` / `remove` / `select` the manager speaks. It joins the manager
   * once that difference is unified.
   */
  registerContent(content: GroupRegionContent<WindowGroup>, regionId: string): RegionBinding {
    return this.bindings.registerContent(content, regionId);
  }

  /**
   * Admit a window an app opened.
   *
   * The manager decides the group: an explicit `groupId`, else the group bound
   * in `region`, else it refuses (a window without a group has nowhere to live).
   * A single-instance app reuses its open window; a window already held is only
   * activated.
   *
   * @param appId - the app that opened the window.
   * @param options - the window id and, optionally, its group or region.
   * @returns the window id.
   */
  admit(appId: string, options: AdmitWindowOptions): string {
    const app = this.apps.get(appId);
    if (app === undefined) throw new Error(`window manager: unknown app: ${appId}`);
    const { windowId } = options;

    const holding = this.groupOf(windowId);
    if (holding !== undefined) {
      holding.select(windowId);
      this.#appOf.set(windowId, appId);
      return windowId;
    }

    if (app.instances === "single") {
      for (const [openId, openApp] of this.#appOf) {
        if (openApp !== appId) continue;
        this.activate(openId);
        return openId;
      }
    }

    const groupId = options.groupId ?? this.groupIn(options.region);
    if (groupId === undefined) {
      throw new Error(`window manager: no group for ${windowId} (app ${appId})`);
    }
    this.open(groupId, { id: windowId });
    this.#appOf.set(windowId, appId);
    if (options.title !== undefined) this.#titles.set(windowId, options.title);
    return windowId;
  }

  /** The title an app gave a window, if any. */
  titleOf(windowId: string): string | undefined {
    return this.#titles.get(windowId);
  }

  /**
   * The content of one app window.
   *
   * The frame renders it for a window item that is not a slot declaration and not
   * a DSH slot: content follows the app that opened the window, not a registration.
   *
   * @param windowId - the window instance.
   * @returns the app's component factory, or `undefined` for a non-app window.
   */
  windowContentFor(windowId: string): (() => ReactNode) | undefined {
    const appId = this.#appOf.get(windowId);
    if (appId === undefined) return undefined;
    return this.apps.get(appId)?.content(windowId);
  }

  /** The first group bound in a region (or a sub-region of it). */
  groupIn(regionId: string | undefined): string | undefined {
    if (regionId === undefined) return undefined;
    return this.bindings.barItems(regionId)[0]?.groupId;
  }

  /** The group runtime that holds a window, if any. */
  groupOf(windowId: string): WindowGroupRuntime | undefined {
    for (const runtime of this.#runtimes.values()) {
      if (runtime.state.order.includes(windowId)) return runtime;
    }
    return undefined;
  }

  /** Every window an app opened (admitted), in no particular order. */
  ids(): readonly string[] {
    return [...this.#appOf.keys()];
  }

  /** The windows a group holds, in the group's order. */
  groupWindows(groupId: string): readonly string[] {
    return this.#runtimes.get(groupId)?.state.order ?? [];
  }

  /**
   * Every open window, or only one app's.
   *
   * @param appId - restrict to one app; omit for all windows.
   * @returns one entry per open window.
   */
  windows(appId?: string): readonly PracWindowInfo[] {
    const infos: PracWindowInfo[] = [];
    for (const runtime of this.#runtimes.values()) {
      for (const id of runtime.state.order) {
        const opener = this.#appOf.get(id);
        if (opener === undefined) continue;
        if (appId !== undefined && opener !== appId) continue;
        infos.push({ id, appId: opener, groupId: runtime.id });
      }
    }
    return infos;
  }

  /** Every registered group id, in registration order. */
  groups(): readonly string[] {
    return [...this.#runtimes.keys()];
  }

  /**
   * Admit one window into a group and make it the group's active window.
   *
   * @param groupId - the group that takes the window.
   * @param window - the source's handle for it.
   */
  open(groupId: string, window: WindowRuntimeHandle): void {
    const runtime = this.#require(groupId);
    runtime.add(window);
    runtime.select(window.id);
    this.#handles.set(window.id, window);
  }

  /**
   * Close a window wherever it is.
   *
   * @param windowId - the window to close.
   * @returns whether a group held it.
   */
  close(windowId: string): boolean {
    const runtime = this.groupOf(windowId);
    if (runtime === undefined) return false;
    runtime.remove(windowId);
    this.#handles.delete(windowId);
    this.#appOf.delete(windowId);
    this.#titles.delete(windowId);
    return true;
  }

  /**
   * Activate a window in its group.
   *
   * @param windowId - the window to activate.
   * @returns whether a group held it.
   */
  activate(windowId: string): boolean {
    const runtime = this.groupOf(windowId);
    if (runtime === undefined) return false;
    runtime.select(windowId);
    return true;
  }

  /**
   * Move a window to another group, keeping the source's handle.
   *
   * The move is **remove + add**: the group runtimes own their order, so the
   * target appends the window and the source drops it.
   *
   * @param windowId - the window to move.
   * @param toGroupId - the destination group.
   * @returns whether the window was held and the target exists.
   */
  move(windowId: string, toGroupId: string): boolean {
    const from = this.groupOf(windowId);
    const to = this.#runtimes.get(toGroupId);
    if (from === undefined || to === undefined || from === to) return false;
    const handle = this.#handles.get(windowId) ?? { id: windowId };
    from.remove(windowId);
    to.add(handle);
    this.#handles.set(windowId, handle);
    return true;
  }

  /** One group bar item per region (delegated to the frame projection). */
  barItems(regionId: string): readonly GroupBarItem[] {
    return this.bindings.barItems(regionId);
  }

  /** The region content registered for a region (delegated). */
  contentFor(regionId: string): GroupRegionContent<WindowGroup> | undefined {
    return this.bindings.contentFor(regionId);
  }

  /** The binding of one registered group (delegated). */
  get(groupId: string): RegionBinding | undefined {
    return this.bindings.get(groupId);
  }

  /** Remove a group's frame projection; the runtime itself is not disposed. */
  unregister(groupId: string): void {
    for (const windowId of this.#runtimes.get(groupId)?.state.order ?? []) {
      this.#handles.delete(windowId);
      this.#appOf.delete(windowId);
      this.#titles.delete(windowId);
    }
    this.#runtimes.delete(groupId);
    this.bindings.unregister(groupId);
  }

  /** Drop every registration and projection. */
  dispose(): void {
    this.#runtimes.clear();
    this.#handles.clear();
    this.#appOf.clear();
    this.#titles.clear();
    this.bindings.dispose();
  }

  #require(groupId: string): WindowGroupRuntime {
    const runtime = this.#runtimes.get(groupId);
    if (runtime === undefined) throw new Error(`window manager: unknown group: ${groupId}`);
    return runtime;
  }
}
