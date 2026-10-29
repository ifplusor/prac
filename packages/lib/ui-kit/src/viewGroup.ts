/**
 * View-group contracts.
 *
 * A group owns membership / order / active; a source owns the lifecycle and the
 * materialized views. The frame only sees this runtime boundary.
 *
 * @module prac-ui-kit/viewGroup
 */

import type { View, ViewHost } from "./view.js";

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

/** One member's placement as the group sees it. */
export interface ViewGroupPlacement {
  readonly viewId: string;
  readonly groupId: string;
  readonly order: number;
  readonly active: boolean;
  readonly visible: boolean;
}

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

/** A materialized group runtime. */
export interface ViewGroupRuntime {
  dispose(): void;
}

/** The structural group shape a frame / surface consumes. */
export interface ViewGroup extends ViewGroupRuntime {
  readonly id: string;
  readonly state: ViewGroupState;
  readonly binding?: GroupBinding;
  readonly placements: readonly ViewGroupPlacement[];
  onDidChange(listener: () => void): () => void;
  reorder(order: readonly string[]): void;
  setBinding?(binding: GroupBinding | undefined): void;
}

/** Optional generic form for consumers that add / remove views. */
export interface MutableViewGroup<TView extends View = View> extends ViewGroup {
  add(view: TView): void;
  remove(viewId: string): void;
}
