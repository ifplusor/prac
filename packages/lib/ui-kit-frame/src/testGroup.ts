/** Test-only frame group; production groups are owned by ui-window / ui-widget. */
import type { WindowGroupBinding } from "./windowModel.js";
import type { WindowGroupMode, WindowGroupPlacement, WindowGroupState } from "./windowModel.js";

export class TestGroup {
  readonly #views = new Map<string, { readonly id: string; release?(): void }>();
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
    return this.#order.map((viewId, order) => ({
      itemId: viewId,
      viewId,
      groupId: this.id,
      order,
      active: this.#active === viewId,
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
    if (this.#views.has(view.id)) throw new Error(`view already in group: ${view.id}`);
    this.#views.set(view.id, view);
    this.#order.push(view.id);
    if (this.mode === "select" && this.#active === undefined) this.#active = view.id;
    this.#emit();
  }

  remove(viewId: string): void {
    if (!this.#views.delete(viewId)) return;
    const index = this.#order.indexOf(viewId);
    if (index !== -1) this.#order.splice(index, 1);
    if (this.#active === viewId) this.#active = this.#order[0];
    this.#emit();
  }

  select(viewId: string | undefined): void {
    if (this.mode !== "select") return;
    if (viewId !== undefined && !this.#views.has(viewId))
      throw new Error(`unknown view: ${viewId}`);
    this.#active = viewId;
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
    for (const view of this.#views.values()) view.release?.();
    this.#views.clear();
    this.#order.length = 0;
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#listeners.clear();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
