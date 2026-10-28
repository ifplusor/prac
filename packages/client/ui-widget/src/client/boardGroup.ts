/**
 * Adapter from the typed `WidgetBoard` model to the frame's group interface.
 *
 * The frame still speaks in `FrameView`s; a board speaks in widget placements.
 * This adapter keeps one `FrameView` per placed widget and makes the board the
 * authority for order / active / binding.
 *
 * @module prac-client-ui-widget/client/boardGroup
 */

import type {
  FrameView,
  GroupBinding,
  ViewGroupPlacement,
  ViewGroupRuntime,
  ViewGroupState,
} from "prac-client-ui-frame/client";

import { WidgetBoard } from "./board.js";

/** A board-backed frame group (stack mode). */
export class WidgetBoardGroup implements ViewGroupRuntime {
  readonly #board: WidgetBoard;
  readonly #views = new Map<string, FrameView>();

  constructor(
    readonly id: string,
    readonly label?: string,
  ) {
    this.#board = new WidgetBoard(id);
  }

  /** Data-side snapshot in the frame's vocabulary. */
  get state(): ViewGroupState {
    return {
      id: this.id,
      mode: "stack",
      ...(this.label === undefined ? {} : { label: this.label }),
      ...(this.#board.state.active === undefined ? {} : { active: this.#board.state.active }),
      order: this.#board.state.order,
    };
  }

  /** Placement entries in board order. */
  get placements(): readonly ViewGroupPlacement[] {
    return this.#board.placements.map((placement) => ({
      viewId: placement.widgetId,
      groupId: this.id,
      order: placement.order,
      active: this.#board.state.active === placement.widgetId,
      visible: true,
    }));
  }

  get binding(): GroupBinding | undefined {
    return this.#board.binding;
  }

  onDidChange(listener: () => void): () => void {
    return this.#board.onDidChange(listener);
  }

  add(view: FrameView): void {
    this.#views.set(view.id, view);
    try {
      this.#board.place(view.id);
    } catch (cause) {
      this.#views.delete(view.id);
      throw cause;
    }
  }

  remove(viewId: string): void {
    const view = this.#views.get(viewId);
    if (!view) return;
    this.#views.delete(viewId);
    this.#board.remove(viewId);
    view.release();
  }

  select(viewId: string | undefined): void {
    if (viewId !== undefined) this.#board.activate(viewId);
  }

  reorder(order: readonly string[]): void {
    this.#board.reorder(order);
  }

  setBinding(binding: GroupBinding | undefined): void {
    this.#board.setBinding(binding);
  }

  /** The frame view for one placed widget, if any. */
  view(viewId: string): FrameView | undefined {
    return this.#views.get(viewId);
  }

  dispose(): void {
    for (const view of this.#views.values()) view.release();
    this.#views.clear();
    this.#board.dispose();
  }
}
