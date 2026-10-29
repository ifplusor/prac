/**
 * Adapter from the typed `WindowGroup` model to the frame's group interface.
 *
 * The frame still speaks in `FrameView`s; this adapter keeps one `FrameView` per
 * open window and lets `WindowGroup` own order / active / lifecycle.
 *
 * @module prac-client-ui-window/client/windowGroupAdapter
 */

import type {
  FrameView,
  FrameViewGroup,
  GroupBinding,
  ViewGroupPlacement,
  ViewGroupRuntime,
  ViewGroupState,
  Surface,
} from "prac-client-ui-frame/lib";

import { WindowGroup } from "./window.js";

/** A window-group-backed frame group (select mode). */
export class WindowGroupAdapter implements ViewGroupRuntime, Surface {
  readonly kind = "window-group" as const;
  #element: HTMLElement | undefined;
  readonly #group: WindowGroup;
  readonly #views = new Map<string, FrameView>();
  #binding: GroupBinding | undefined;

  constructor(
    readonly id: string,
    readonly label?: string,
  ) {
    this.#group = new WindowGroup(id);
  }

  get group(): FrameViewGroup {
    return this as unknown as FrameViewGroup;
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

  get state(): ViewGroupState {
    return {
      id: this.id,
      mode: "select",
      ...(this.label === undefined ? {} : { label: this.label }),
      ...(this.#group.state.active === undefined ? {} : { active: this.#group.state.active }),
      order: this.#group.state.order,
    };
  }

  get placements(): readonly ViewGroupPlacement[] {
    return this.#group.state.order.map((viewId, order) => ({
      viewId,
      groupId: this.id,
      order,
      active: this.#group.state.active === viewId,
      visible: true,
    }));
  }

  get binding(): GroupBinding | undefined {
    return this.#binding;
  }

  onDidChange(listener: () => void): () => void {
    return this.#group.onDidChange(listener);
  }

  add(view: FrameView): void {
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
    view.release();
  }

  select(viewId: string | undefined): void {
    if (viewId !== undefined) this.#group.activate(viewId);
  }

  reorder(order: readonly string[]): void {
    this.#group.reorder(order);
  }

  setBinding(binding: GroupBinding | undefined): void {
    this.#binding?.dispose();
    this.#binding = binding;
  }

  /** The frame view for one open window, if any. */
  view(viewId: string): FrameView | undefined {
    return this.#views.get(viewId);
  }

  dispose(): void {
    for (const view of this.#views.values()) view.release();
    this.#views.clear();
    this.#binding?.dispose();
    this.#binding = undefined;
    this.#group.dispose();
  }
}
