/**
 * Window and window-group data model.
 *
 * A window is an app-opened instance; a window group is the ordered set of
 * windows shown in one tab strip. The frame owns placement and chrome; this
 * module owns identity, order, active window and lifecycle rules.
 *
 * @module prac-client-ui-frame/client/window
 */

/** The two window kinds. */
export type WindowKind = "application" | "widget";

/** One open window. */
export interface WindowRecord {
  readonly id: string;
  readonly appId: string;
  /** The app definition version pinned when this window was opened. */
  readonly appVersion?: string;
  readonly kind: WindowKind;
  readonly title: string;
  readonly icon?: string;
  /** Optional key for single-instance apps (file path, conversation id, …). */
  readonly instanceKey?: string;
}

/** The data shape of one window group. */
export interface WindowGroupState {
  readonly id: string;
  readonly active?: string;
  readonly order: readonly string[];
}

/** Runtime window group: ordered windows with one active window. */
export class WindowGroup {
  readonly #windows = new Map<string, WindowRecord>();
  readonly #order: string[] = [];
  readonly #listeners = new Set<() => void>();
  #active: string | undefined;
  #disposed = false;

  constructor(readonly id: string) {}

  /** Current data-side snapshot. */
  get state(): WindowGroupState {
    return {
      id: this.id,
      ...(this.#active === undefined ? {} : { active: this.#active }),
      order: [...this.#order],
    };
  }

  /** The active window record, if any. */
  get activeWindow(): WindowRecord | undefined {
    return this.#active === undefined ? undefined : this.#windows.get(this.#active);
  }

  /** Enumerate windows in group order. */
  get windows(): readonly WindowRecord[] {
    return this.#order
      .map((id) => this.#windows.get(id))
      .filter((w): w is WindowRecord => w !== undefined);
  }

  /** Subscribe to order / active changes. */
  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Open a window at the end of the group; first window becomes active. */
  open(window: WindowRecord): void {
    this.#assertLive();
    if (this.#windows.has(window.id)) throw new Error(`window already open: ${window.id}`);
    this.#windows.set(window.id, window);
    this.#order.push(window.id);
    if (this.#active === undefined) this.#active = window.id;
    this.#emit();
  }

  /**
   * Open a window by id.
   *
   * The bindings' `join` speaks ids (a window placed into a region by the
   * manager carries no record yet), so the product group accepts one and fills
   * the minimal record the chrome needs.
   *
   * @param id - the window to append.
   */
  openWindow(id: string): void {
    if (this.#windows.has(id)) return;
    this.open({ id, appId: "prac.board", kind: "application", title: id });
  }

  /** Close a window; active falls back to the next window, then the previous. */
  close(windowId: string): void {
    this.#assertLive();
    if (!this.#windows.delete(windowId)) return;
    const index = this.#order.indexOf(windowId);
    if (index !== -1) this.#order.splice(index, 1);
    if (this.#active === windowId) {
      this.#active = this.#order[index] ?? this.#order[index - 1] ?? this.#order[0];
    }
    this.#emit();
  }

  /** Activate an open window. */
  activate(windowId: string): void {
    this.#assertLive();
    if (!this.#windows.has(windowId)) throw new Error(`unknown window: ${windowId}`);
    if (this.#active === windowId) return;
    this.#active = windowId;
    this.#emit();
  }

  /** Reorder the whole group; the set must match the open windows. */
  reorder(order: readonly string[]): void {
    this.#assertLive();
    if (order.length !== this.#order.length) throw new Error(`order length mismatch: ${this.id}`);
    const seen = new Set<string>();
    for (const windowId of order) {
      if (!this.#windows.has(windowId)) throw new Error(`unknown window in order: ${windowId}`);
      if (seen.has(windowId)) throw new Error(`duplicate window in order: ${windowId}`);
      seen.add(windowId);
    }
    this.#order.splice(0, this.#order.length, ...order);
    this.#emit();
  }

  /** Whether the group has no windows. */
  get empty(): boolean {
    return this.#order.length === 0;
  }

  /** Release listeners; windows are owned by the app / source. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#windows.clear();
    this.#order.length = 0;
    this.#active = undefined;
    this.#listeners.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error(`window group disposed: ${this.id}`);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
