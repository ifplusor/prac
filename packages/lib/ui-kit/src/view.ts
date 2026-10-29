/**
 * Materialized view boundary.
 *
 * @module prac-ui-kit/view
 */

/** A per-view runtime boundary; the host owns the mounted DOM. */
export interface ViewHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly focusable: boolean;
}

/** A source-owned hint passed when a view moves between groups. */
export interface MoveIntent {
  readonly fromViewGroupId: string;
  readonly toViewGroupId: string;
  readonly reason: "user" | "layout" | "editor-split";
  readonly preserve?: "auto" | "state" | "never";
}

/** A materialized view. */
export interface View {
  readonly id: string;
  readonly host: ViewHost | undefined;
  mount(host: ViewHost, element: HTMLElement): void;
  release(): void;
  focus(): void;
  /** Optional disposal for source-owned views. */
  dispose?(): void;
}

/** A materialized view runtime. */
export interface ViewRuntime {
  dispose(): void;
}
