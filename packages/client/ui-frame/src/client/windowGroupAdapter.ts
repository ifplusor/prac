import type {
  WindowGroup as KitWindowGroup,
  WindowGroupBinding,
  WindowGroupPlacement,
  WindowGroupState,
  RegionContent,
} from "prac-ui-kit-workbench";
/**
 * Adapter from the typed `WindowGroup` model to the frame's product
 * `WindowsGroup` contract.
 *
 * The frame no longer speaks in `FrameView`s: a window group is the product
 * object, and this adapter keeps only a minimal release handle per open window
 * while `WindowGroup` owns order / active / lifecycle.
 *
 * @module prac-client-ui-frame/client/windowGroupAdapter
 */

import { WindowGroup } from "./window.js";

/** The release handle a source hands the adapter for one window. */
export interface WindowViewHandle {
  readonly id: string;
  release?(): void;
}

/** A window-group-backed frame group (select mode). */
export class WindowGroupAdapter implements KitWindowGroup, RegionContent<KitWindowGroup> {
  readonly kind = "window-group" as const;
  #element: HTMLElement | undefined;
  readonly #group: WindowGroup;
  readonly #views = new Map<string, WindowViewHandle>();
  #binding: WindowGroupBinding | undefined;

  constructor(
    readonly id: string,
    readonly label?: string,
  ) {
    this.#group = new WindowGroup(id);
  }

  get group(): KitWindowGroup {
    return this;
  }

  get element(): HTMLElement | undefined {
    return this.#element;
  }

  attach(element: HTMLElement): void {
    this.#element = element;
  }

  detach(element: HTMLElement): void {
    if (this.#element === element) this.#element = undefined;
  }

  get state(): WindowGroupState {
    return {
      id: this.id,
      mode: "select",
      ...(this.label === undefined ? {} : { label: this.label }),
      ...(this.#group.state.active === undefined ? {} : { active: this.#group.state.active }),
      order: this.#group.state.order,
    };
  }

  get placements(): readonly WindowGroupPlacement[] {
    return this.#group.state.order.map((viewId, order) => ({
      itemId: viewId,
      viewId,
      groupId: this.id,
      order,
      active: this.#group.state.active === viewId,
      visible: true,
    }));
  }

  get binding(): WindowGroupBinding | undefined {
    return this.#binding;
  }

  onDidChange(listener: () => void): () => void {
    return this.#group.onDidChange(listener);
  }

  add(view: WindowViewHandle): void {
    this.#views.set(view.id, view);
    try {
      this.#group.open({
        id: view.id,
        appId: "editor",
        kind: "application",
        title: view.id,
      });
    } catch (cause) {
      this.#views.delete(view.id);
      throw cause;
    }
  }

  remove(viewId: string): void {
    const view = this.#views.get(viewId);
    if (!view) return;
    this.#views.delete(viewId);
    this.#group.close(viewId);
    view.release?.();
  }

  select(viewId: string | undefined): void {
    if (viewId !== undefined) this.#group.activate(viewId);
  }

  reorder(order: readonly string[]): void {
    this.#group.reorder(order);
  }

  setBinding(binding: WindowGroupBinding | undefined): void {
    this.#binding?.dispose();
    this.#binding = binding;
  }

  dispose(): void {
    for (const view of this.#views.values()) view.release?.();
    this.#views.clear();
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#group.dispose();
  }
}
