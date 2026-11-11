import type { ReactNode } from "react";
/**
 * Application definitions: what prac can launch.
 *
 * An application is a **launch identity**, not a content container: it says what
 * windows may be opened (one or many), where a window lands by default, and what
 * one window instance renders. Windows themselves are instances owned by the
 * window manager; a partner contributes applications and widgets, never windows.
 *
 * This module is pure bookkeeping (definitions, uniqueness, change notification).
 * Opening, group membership, placement and active state belong to the window
 * manager.
 *
 * @module prac-ui-kit-workbench/applications
 */

/** One launchable application. */
export interface ApplicationDefinition {
  /** Stable id (`editor`, `chat`, `board`, …). */
  readonly id: string;
  /** Definition version; a window pins the version it was opened with. */
  readonly version?: string;
  /** Human label used by launchers and window titles. */
  readonly label: string;
  /**
   * How many windows the app may have open.
   *
   * - `single`: one window, re-opened rather than duplicated (chat);
   * - `multi`: one window per instance key (an editor file, a board window).
   */
  readonly instances: "single" | "multi";
  /** Region a new window lands in when the arrangement has no rule for it. */
  readonly defaultRegion?: string;
  /** The app's icon class, when its windows show one in the chrome. */
  readonly icon?: string;
  /**
   * Whether an app window brings its own native pane header.
   *
   * When true the frame overlays only its fold / drag controls on the app's own
   * header instead of drawing a second row.
   */
  readonly paneHeader?: boolean;
  /**
   * Whether this app handles a resource.
   *
   * The open pipeline asks every app in registration order and uses the first
   * match; the application registry plays the LaunchServices role, so a code
   * app must not claim a document its document app owns.
   */
  match?(resource: string): boolean;
  /** Open one resource inside this app; the app owns the window it creates. */
  open?(params: unknown): boolean;
  /**
   * The content of one window instance.
   *
   * Called by the frame when it renders that window, never by this registry:
   * resolving content is a rendering decision, not a registration one.
   *
   * @param windowId - the window instance id.
   * @param render - the host's slot renderer, bound to the host's declared
   *   child slots; an app whose body is a host panel renders it through this.
   * @returns the component that renders the instance.
   */
  content?(
    windowId: string,
    render?: ApplicationSlotRenderer,
    view?: ApplicationViewport,
  ): () => ReactNode;
}

/**
 * The host's slot renderer, handed to an app whose body is a host-owned panel.
 *
 * @param slot - the child slot name (`main`, `sidebar`, …).
 * @param props - the slot's props.
 * @param options - the entry key / options the host's binding expects.
 * @returns the rendered slot.
 */
export type ApplicationSlotRenderer = (
  slot: string,
  props: Record<string, unknown>,
  options?: { readonly entryKey?: string },
) => ReactNode;

/** The box an app window renders into (a host panel uses it for its props). */
export interface ApplicationViewport {
  readonly width: number;
  readonly viewportWidth: number;
}

/** The application table: who can be launched. */
/** One running app instance: the launch params and the windows it owns. */
export interface PracAppInstance {
  readonly id: string;
  readonly appId: string;
  readonly params?: unknown;
  readonly windows: readonly string[];
}

/**
 * The app instance manager: the OS's process table.
 *
 * It owns instance identity and the instance → windows relation. It never
 * touches a window (the window manager does); it records which windows an
 * instance holds and disposes an instance when its last window closes.
 */
export class PracAppInstances {
  readonly #instances = new Map<string, PracAppInstance>();
  readonly #listeners = new Set<() => void>();
  #next = 0;

  /** One instance by id (the only lookup: callers hold the id, not a matcher). */
  get(instanceId: string): PracAppInstance | undefined {
    return this.#instances.get(instanceId);
  }

  /** Every running instance. */
  list(): readonly PracAppInstance[] {
    return [...this.#instances.values()];
  }

  /** Start one instance and return it. */
  create(appId: string, params?: unknown): PracAppInstance {
    const id = `${appId}:${++this.#next}`;
    const instance: PracAppInstance = {
      id,
      appId,
      ...(params === undefined ? {} : { params }),
      windows: [],
    };
    this.#instances.set(id, instance);
    this.#notify();
    return instance;
  }

  /** Record a window the instance owns. */
  addWindow(instanceId: string, windowId: string): void {
    const instance = this.#instances.get(instanceId);
    if (instance === undefined || instance.windows.includes(windowId)) return;
    this.#instances.set(instanceId, { ...instance, windows: [...instance.windows, windowId] });
    this.#notify();
  }

  /** Drop one window; the last one disposes the instance. */
  removeWindow(instanceId: string, windowId: string): void {
    const instance = this.#instances.get(instanceId);
    if (instance === undefined) return;
    const windows = instance.windows.filter((id) => id !== windowId);
    if (windows.length === instance.windows.length) return;
    if (windows.length === 0) this.#instances.delete(instanceId);
    else this.#instances.set(instanceId, { ...instance, windows });
    this.#notify();
  }

  /** Drop one instance. */
  dispose(instanceId: string): void {
    if (this.#instances.delete(instanceId)) this.#notify();
  }

  /** Subscribe to instance creation / removal. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export class ApplicationRegistry {
  readonly #apps = new Map<string, ApplicationDefinition>();
  readonly #instances: PracAppInstances | undefined;

  constructor(instances?: PracAppInstances) {
    this.#instances = instances;
  }

  readonly #listeners = new Set<() => void>();
  #disposed = false;

  /**
   * Add one application.
   *
   * @param app - the definition.
   * @returns the disposer that removes it again.
   * @throws when the id is already registered or the registry is disposed.
   */
  register(app: ApplicationDefinition): () => void {
    if (this.#disposed) throw new Error("application registry: register after dispose");
    if (this.#apps.has(app.id))
      throw new Error(`application registry: ${app.id} already registered`);
    this.#apps.set(app.id, app);
    this.#notify();
    return () => {
      if (this.#apps.get(app.id) !== app) return;
      this.#apps.delete(app.id);
      this.#notify();
    };
  }

  /**
   * Read one application.
   *
   * @param id - the application id.
   * @returns the definition, or `undefined`.
   */
  get(id: string): ApplicationDefinition | undefined {
    return this.#apps.get(id);
  }

  /** Every registered application, in registration order. */
  list(): readonly ApplicationDefinition[] {
    return [...this.#apps.values()];
  }

  /**
   * Find the app that handles a resource — the LaunchServices role.
   *
   * @param resource - the workspace path or URI to open.
   * @returns the first app whose `match` accepts it, or `undefined`.
   */
  openApp(appId: string, params?: unknown): PracAppInstance | undefined {
    const app = this.#apps.get(appId);
    if (app === undefined) return undefined;
    const instance = this.#instances?.create(appId, params);
    app.open?.(params);
    return instance;
  }

  open(resource: string): ApplicationDefinition | undefined {
    for (const app of this.#apps.values()) {
      if (app.match?.(resource) !== true) continue;
      app.open?.(resource);
      return app;
    }
    return undefined;
  }

  /**
   * Subscribe to registrations and removals.
   *
   * @param listener - called after every change.
   * @returns the unsubscribe function.
   */
  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Drop every definition and listener. */
  dispose(): void {
    this.#disposed = true;
    this.#apps.clear();
    this.#listeners.clear();
  }

  #notify(): void {
    for (const listener of Array.from(this.#listeners)) listener();
  }
}
