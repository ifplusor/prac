/**
 * A concrete window group: one primary window plus windows hosted beside it.
 *
 * The frame consumes the `WindowGroup` contract; this class is the generic
 * implementation L3 adapters can compose instead of re-implementing order,
 * active window and placement projection.
 *
 * @module prac-ui-kit-workbench/windowGroupModel
 */

import type {
  Window,
  WindowGroup,
  WindowGroupPlacement,
  WindowGroupState,
} from "./workbenchModel.js";

/** A window group with one owned primary window and any hosted windows. */
export class WindowGroupModel implements WindowGroup {
  readonly #extra: string[] = [];
  readonly #listeners = new Set<() => void>();
  #active: string;
  #disposed = false;

  constructor(
    readonly id: string,
    readonly primary: Window,
    readonly label?: string,
  ) {
    this.#active = primary.id;
  }

  get state(): WindowGroupState {
    return {
      id: this.id,
      mode: "select",
      ...(this.label === undefined ? {} : { label: this.label }),
      active: this.#active,
      order: this.#order(),
    };
  }

  get placements(): readonly WindowGroupPlacement[] {
    return this.#order().map((itemId, order) => ({
      itemId,
      groupId: this.id,
      order,
      active: itemId === this.#active,
      visible: true,
      // The primary window belongs to the group; hosted windows are owned by
      // whoever placed them, so losing membership must not delete their records.
      ...(itemId === this.primary.id ? {} : { owned: false }),
    }));
  }

  get windows(): readonly Window[] {
    return [this.primary];
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reorder(order: readonly string[]): void {
    const current = new Set(this.#order());
    if (order.length !== current.size || order.some((id) => !current.has(id))) {
      throw new Error(`window group ${this.id}: order must be a permutation of its windows`);
    }
    this.#extra.splice(0, this.#extra.length, ...order.filter((id) => id !== this.primary.id));
    this.#emit();
  }

  /** Host another window beside the primary one. */
  openWindow(itemId: string): void {
    if (itemId === this.primary.id || this.#extra.includes(itemId)) return;
    this.#extra.push(itemId);
    this.#active = itemId;
    this.#emit();
  }

  /** Close a hosted window; the primary cannot be closed this way. */
  closeWindow(itemId: string): void {
    const index = this.#extra.indexOf(itemId);
    if (index === -1) return;
    this.#extra.splice(index, 1);
    if (this.#active === itemId) this.#active = this.primary.id;
    this.#emit();
  }

  /** Make one hosted or primary window active. */
  activateWindow(itemId: string): void {
    if (!this.#order().includes(itemId)) throw new Error(`unknown window: ${itemId}`);
    if (this.#active === itemId) return;
    this.#active = itemId;
    this.#emit();
  }

  /** Replace the hosted windows from another owner's placement projection. */
  syncWindows(itemIds: readonly string[]): void {
    const next = itemIds.filter((itemId) => itemId !== this.primary.id);
    if (
      next.length === this.#extra.length &&
      next.every((itemId, index) => itemId === this.#extra[index])
    ) {
      return;
    }
    this.#extra.splice(0, this.#extra.length, ...next);
    if (!this.#order().includes(this.#active)) this.#active = this.primary.id;
    this.#emit();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  #order(): readonly string[] {
    return [this.primary.id, ...this.#extra];
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
