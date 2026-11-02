/**
 * Runtime registry for board layout roots.
 *
 * A board window's content is a `LayoutState<WidgetRecord>` owned by the board.
 * The frame resolves `ItemRecord.boardId` through this registry and renders that
 * root with the generic `LayoutRenderer`; it is the board-side analogue of
 * `ContentHostRegistry`.
 *
 * A board's state is **live**: the entry exposes `getState` / `subscribe`, so the
 * frame re-renders when a widget is added, folded, moved or resized instead of
 * pinning the snapshot that existed when the board registered.
 *
 * @module prac-ui-kit-workbench/board-layouts
 */
import type { ChromeRegistry } from "prac-ui-kit-content";
import type { LayoutState, WidgetRecord } from "./contract.js";

/** The live board state a container publishes. `BoardContent` qualifies. */
export interface BoardLayoutSource {
  getState(): LayoutState<WidgetRecord>;
  subscribe(listener: () => void): () => void;
}

/** A board root plus the chrome its container registers. */
export interface BoardLayout {
  readonly boardId: string;
  readonly getState: () => LayoutState<WidgetRecord>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly chrome?: ChromeRegistry<WidgetRecord>;
}

/** Whether a registration argument is a live source rather than a snapshot. */
function isSource(
  value: BoardLayoutSource | LayoutState<WidgetRecord>,
): value is BoardLayoutSource {
  return typeof (value as BoardLayoutSource).getState === "function";
}

/** Board-id → board layout registry for one frame. */
export class BoardLayoutRegistry {
  readonly #states = new Map<string, BoardLayout>();

  /**
   * Register a board root.
   *
   * @param boardId - the id a window record's `boardId` names.
   * @param source - the live board (a `BoardContent`) or a snapshot state.
   * @param chrome - the board's chrome contributions.
   * @returns the unregister function.
   */
  register(
    boardId: string,
    source: BoardLayoutSource | LayoutState<WidgetRecord>,
    chrome?: ChromeRegistry<WidgetRecord>,
  ): () => void {
    const entry: BoardLayout = isSource(source)
      ? {
          boardId,
          getState: () => source.getState(),
          subscribe: (listener) => source.subscribe(listener),
          ...(chrome === undefined ? {} : { chrome }),
        }
      : {
          boardId,
          getState: () => source,
          subscribe: () => () => {},
          ...(chrome === undefined ? {} : { chrome }),
        };
    this.#states.set(boardId, entry);
    return () => {
      if (this.#states.get(boardId) === entry) this.#states.delete(boardId);
    };
  }

  get(boardId: string): BoardLayout | undefined {
    return this.#states.get(boardId);
  }

  delete(boardId: string): void {
    this.#states.delete(boardId);
  }
}
