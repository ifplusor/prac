/**
 * Widget board data model.
 *
 * A board owns widget placements and one active widget. It does not own widget
 * definitions or hosts; those belong to the registry / source.
 *
 * @module prac-client-ui-widget/client/board
 */

import type { BoardBinding, WidgetPlacement } from "./widget.js";

/** The data shape of one board. */
export interface WidgetBoardState {
  readonly id: string;
  readonly active?: string;
  readonly order: readonly string[];
}

/** Runtime board: ordered widget placements with one active widget. */
export class WidgetBoard {
  readonly #placements = new Map<string, WidgetPlacement>();
  readonly #order: string[] = [];
  readonly #listeners = new Set<() => void>();
  #active: string | undefined;
  #binding: BoardBinding | undefined;
  #disposed = false;

  constructor(readonly id: string) {}

  /** Current data-side snapshot. */
  get state(): WidgetBoardState {
    return {
      id: this.id,
      ...(this.#active === undefined ? {} : { active: this.#active }),
      order: [...this.#order],
    };
  }

  /** Placements in board order. */
  get placements(): readonly WidgetPlacement[] {
    return this.#order
      .map((id) => this.#placements.get(id))
      .filter((p): p is WidgetPlacement => p !== undefined);
  }

  /** The current source binding, if any. */
  get binding(): BoardBinding | undefined {
    return this.#binding;
  }

  /** Subscribe to placement / active changes. */
  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Place a widget at the end of the board; first widget becomes active. */
  place(widgetId: string): void {
    this.#assertLive();
    if (this.#placements.has(widgetId)) throw new Error(`widget already placed: ${widgetId}`);
    const placement: WidgetPlacement = {
      widgetId,
      boardId: this.id,
      order: this.#order.length,
    };
    this.#placements.set(widgetId, placement);
    this.#order.push(widgetId);
    if (this.#active === undefined) this.#active = widgetId;
    this.#emit();
  }

  /** Remove a widget; active falls back to the next, then the previous. */
  remove(widgetId: string): void {
    this.#assertLive();
    if (!this.#placements.delete(widgetId)) return;
    const index = this.#order.indexOf(widgetId);
    if (index !== -1) this.#order.splice(index, 1);
    if (this.#active === widgetId) {
      this.#active = this.#order[index] ?? this.#order[index - 1] ?? this.#order[0];
    }
    this.#emit();
  }

  /** Activate a placed widget. */
  activate(widgetId: string): void {
    this.#assertLive();
    if (!this.#placements.has(widgetId)) throw new Error(`unknown widget: ${widgetId}`);
    if (this.#active === widgetId) return;
    this.#active = widgetId;
    this.#emit();
  }

  /** Reorder the whole board; the set must match the placed widgets. */
  reorder(order: readonly string[]): void {
    this.#assertLive();
    if (order.length !== this.#order.length) throw new Error(`order length mismatch: ${this.id}`);
    const seen = new Set<string>();
    for (const widgetId of order) {
      if (!this.#placements.has(widgetId)) throw new Error(`unknown widget in order: ${widgetId}`);
      if (seen.has(widgetId)) throw new Error(`duplicate widget in order: ${widgetId}`);
      seen.add(widgetId);
    }
    this.#order.splice(0, this.#order.length, ...order);
    for (const [index, widgetId] of this.#order.entries()) {
      const placement = this.#placements.get(widgetId);
      if (placement) this.#placements.set(widgetId, { ...placement, order: index });
    }
    this.#emit();
  }

  /** Set or clear the source binding. The previous binding is disposed. */
  setBinding(binding: BoardBinding | undefined): void {
    this.#assertLive();
    if (this.#binding === binding) return;
    this.#binding?.dispose();
    this.#binding = binding;
    this.#emit();
  }

  /** Whether the board has no widgets. */
  get empty(): boolean {
    return this.#order.length === 0;
  }

  /** Release listeners and binding; widget hosts are owned by the source. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#placements.clear();
    this.#order.length = 0;
    this.#active = undefined;
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#listeners.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error(`widget board disposed: ${this.id}`);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
