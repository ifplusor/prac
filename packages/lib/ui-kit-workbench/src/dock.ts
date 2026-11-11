/**
 * The dock: the pinned app shortcuts.
 *
 * A dock item is a launch shortcut (app id + params), not a window. It owns the
 * pins and their persistence; the running state comes from the app instances and
 * the active state from the window manager, so the dock only stores intent.
 *
 * @module prac/dock
 */

/** One pinned app shortcut. */
export interface PracDockItem {
  readonly id: string;
  readonly appId: string;
  /** The label the dock shows. */
  readonly label: string;
  /** Which dock holds it. */
  readonly side: "left" | "right";
  /** Launch params, opaque to the core (a board id, a conversation, …). */
  readonly params?: unknown;
  /** The instance the last launch produced. */
  readonly instanceId?: string;
}

const KEY = "prac-dock/v1";

/** The dock's pins, persisted across reloads. */
export class PracDock {
  readonly #items = new Map<string, PracDockItem>();
  readonly #listeners = new Set<() => void>();

  constructor() {
    for (const item of readDock()) this.#items.set(item.id, item);
  }

  /** Every pin, in insertion order. */
  list(): readonly PracDockItem[] {
    return [...this.#items.values()];
  }

  /** Pin (or replace) one shortcut. */
  pin(item: PracDockItem): void {
    this.#items.set(item.id, item);
    this.#persist();
    this.#notify();
  }

  /** Unpin one shortcut. */
  unpin(id: string): void {
    if (!this.#items.delete(id)) return;
    this.#persist();
    this.#notify();
  }

  /** Subscribe to pins. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list()));
    } catch {
      // localStorage may be unavailable; the dock still works in memory.
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

function readDock(): PracDockItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PracDockItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { appId?: unknown }).appId === "string",
    );
  } catch {
    return [];
  }
}
