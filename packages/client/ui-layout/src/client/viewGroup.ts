/**
 * The runtime side of one view group.
 *
 * `ViewGroupState` is the data side; this class is the runtime object that holds
 * view slots, the selected view, and the optional source binding. It never owns
 * a source identity or placement: those stay outside the runtime.
 *
 * @module prac-client-ui-layout/client/viewGroup
 */

import type { GroupBinding, ViewGroupRuntime } from "./resource.js";
import type { FrameView } from "./view.js";

/** How a group presents its member views. */
export type ViewGroupMode = "stack" | "select";

/** The data shape of one view group. */
export interface ViewGroupState {
  readonly id: string;
  readonly mode: ViewGroupMode;
  readonly label?: string;
  readonly active?: string;
  readonly order: readonly string[];
}

/** One member's placement as the frame sees it. */
export interface ViewGroupPlacement {
  readonly viewId: string;
  readonly groupId: string;
  readonly order: number;
  readonly active: boolean;
  readonly visible: boolean;
}

/** Runtime group: one per `ViewGroupState`. */
export class ViewGroup implements ViewGroupRuntime {
  readonly #views = new Map<string, FrameView>();
  readonly #order: string[] = [];
  #mode: ViewGroupMode;
  #active: string | undefined;
  #binding: GroupBinding | undefined;
  #disposed = false;
  readonly #listeners = new Set<() => void>();

  constructor(
    readonly id: string,
    mode: ViewGroupMode = "stack",
    readonly label?: string,
  ) {
    this.#mode = mode;
  }

  /** Current data-side snapshot. */
  get state(): ViewGroupState {
    return {
      id: this.id,
      mode: this.#mode,
      ...(this.label === undefined ? {} : { label: this.label }),
      ...(this.#active === undefined ? {} : { active: this.#active }),
      order: [...this.#order],
    };
  }

  /** The current source binding, if any. */
  get binding(): GroupBinding | undefined {
    return this.#binding;
  }

  /** The group's members in frame order, with the active flag. */
  get placements(): readonly ViewGroupPlacement[] {
    return this.#order.map((viewId, order) => ({
      viewId,
      groupId: this.id,
      order,
      active: this.#active === viewId,
      visible: true,
    }));
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Whether this group currently holds the view. */
  has(viewId: string): boolean {
    return this.#views.has(viewId);
  }

  /** Look up a member view without changing its host. */
  get(viewId: string): FrameView | undefined {
    return this.#views.get(viewId);
  }

  /** Add a view to the end of the group order. */
  add(view: FrameView): void {
    this.#assertLive();
    if (this.#views.has(view.id)) throw new Error(`view already in group: ${view.id}`);
    this.#views.set(view.id, view);
    this.#order.push(view.id);
    if (this.#mode === "select" && this.#active === undefined) this.#active = view.id;
    this.#emit();
  }

  /** Remove a view from the group and release its host. */
  remove(viewId: string): void {
    this.#assertLive();
    const view = this.#views.get(viewId);
    if (!view) return;
    this.#views.delete(viewId);
    const index = this.#order.indexOf(viewId);
    if (index !== -1) this.#order.splice(index, 1);
    view.release();
    if (this.#active === viewId) {
      this.#active = this.#order[0];
    }
    this.#emit();
  }

  /** Select a view. Only a select group has an active view. */
  select(viewId: string | undefined): void {
    this.#assertLive();
    if (this.#mode !== "select") {
      if (viewId !== undefined) throw new Error(`stack group has no active view: ${this.id}`);
      return;
    }
    if (viewId !== undefined && !this.#views.has(viewId)) {
      throw new Error(`unknown view: ${viewId}`);
    }
    this.#active = viewId;
    this.#emit();
  }

  /** Reorder the whole group; the set must match the current members. */
  reorder(order: readonly string[]): void {
    this.#assertLive();
    if (order.length !== this.#order.length) throw new Error(`order length mismatch: ${this.id}`);
    const seen = new Set<string>();
    for (const viewId of order) {
      if (!this.#views.has(viewId)) throw new Error(`unknown view in order: ${viewId}`);
      if (seen.has(viewId)) throw new Error(`duplicate view in order: ${viewId}`);
      seen.add(viewId);
    }
    this.#order.splice(0, this.#order.length, ...order);
    this.#emit();
  }

  /** Set or clear the source binding. The previous binding is disposed. */
  setBinding(binding: GroupBinding | undefined): void {
    this.#assertLive();
    if (this.#binding === binding) return;
    this.#binding?.dispose();
    this.#binding = binding;
    this.#emit();
  }

  /** Release all hosted views and the current binding. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const view of this.#views.values()) view.release();
    this.#views.clear();
    this.#order.length = 0;
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#emit();
    this.#listeners.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error(`view group disposed: ${this.id}`);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
