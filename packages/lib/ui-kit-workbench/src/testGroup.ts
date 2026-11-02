/** Test-only frame group; production groups are owned by prac-client-ui-frame / prac-client-ui-widget. */
import type { WindowGroupBinding } from "./workbenchModel.js";
import type { WindowGroupMode, WindowGroupPlacement, WindowGroupState } from "./workbenchModel.js";

export class TestGroup {
  readonly #items = new Map<string, { readonly id: string; release?(): void }>();
  readonly #order: string[] = [];
  readonly #listeners = new Set<() => void>();
  #active: string | undefined;
  #binding: WindowGroupBinding | undefined;

  constructor(
    readonly id: string,
    readonly mode: WindowGroupMode = "stack",
    readonly label?: string,
  ) {}

  get state(): WindowGroupState {
    return {
      id: this.id,
      mode: this.mode,
      ...(this.label === undefined ? {} : { label: this.label }),
      ...(this.#active === undefined ? {} : { active: this.#active }),
      order: [...this.#order],
    };
  }

  get placements(): readonly WindowGroupPlacement[] {
    return this.#order.map((itemId, order) => ({
      itemId,
      groupId: this.id,
      order,
      active: this.#active === itemId,
      visible: true,
    }));
  }

  get binding(): WindowGroupBinding | undefined {
    return this.#binding;
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  add(view: { readonly id: string; release?(): void }): void {
    if (this.#items.has(view.id)) throw new Error(`view already in group: ${view.id}`);
    this.#items.set(view.id, view);
    this.#order.push(view.id);
    if (this.mode === "select" && this.#active === undefined) this.#active = view.id;
    this.#emit();
  }

  remove(itemId: string): void {
    if (!this.#items.delete(itemId)) return;
    const index = this.#order.indexOf(itemId);
    if (index !== -1) this.#order.splice(index, 1);
    if (this.#active === itemId) this.#active = this.#order[0];
    this.#emit();
  }

  select(itemId: string | undefined): void {
    if (this.mode !== "select") return;
    if (itemId !== undefined && !this.#items.has(itemId))
      throw new Error(`unknown view: ${itemId}`);
    this.#active = itemId;
    this.#emit();
  }

  reorder(order: readonly string[]): void {
    this.#order.splice(0, this.#order.length, ...order);
    this.#emit();
  }

  setBinding(binding: WindowGroupBinding | undefined): void {
    this.#binding?.dispose();
    this.#binding = binding;
    this.#emit();
  }

  dispose(): void {
    for (const view of this.#items.values()) view.release?.();
    this.#items.clear();
    this.#order.length = 0;
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#listeners.clear();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
