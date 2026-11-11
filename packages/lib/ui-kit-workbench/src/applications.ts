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
export class ApplicationRegistry {
  readonly #apps = new Map<string, ApplicationDefinition>();
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
  openApp(appId: string, params?: unknown): ApplicationDefinition | undefined {
    const app = this.#apps.get(appId);
    if (app === undefined) return undefined;
    app.open?.(params);
    return app;
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
