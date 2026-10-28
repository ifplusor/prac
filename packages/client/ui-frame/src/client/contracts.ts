/**
 * Runtime contracts shared by the frame and its source adapters.
 *
 * These are plain interfaces, not CRD definitions: no envelope, no materializer,
 * no phase. A widget / board / window is created by its owner through a typed
 * factory; the frame only sees these runtime boundaries.
 *
 * @module prac-client-ui-frame/client/contracts
 */

/** One action a group bar may render. */
export interface GroupAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly tooltip?: string;
  readonly submenu?: readonly GroupAction[];
}

/** A source-specific group runtime binding. */
export interface GroupBinding {
  dispose(): void;
}

/** A group binding that can also drive its title bar. */
export interface GroupActionBinding extends GroupBinding {
  actions(): readonly GroupAction[];
  runAction(actionId: string): void;
}

/** A per-view runtime boundary. */
export interface ViewHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly focusable: boolean;
}

/** A source-owned hint passed when a view moves between view groups. */
export interface MoveIntent {
  readonly fromViewGroupId: string;
  readonly toViewGroupId: string;
  readonly reason: "user" | "layout" | "editor-split";
  readonly preserve?: "auto" | "state" | "never";
}

/** A materialized group runtime. */
export interface ViewGroupRuntime {
  dispose(): void;
}

/** A materialized view runtime. */
export interface ViewRuntime {
  dispose(): void;
}
