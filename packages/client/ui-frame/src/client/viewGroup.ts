/**
 * Data shapes for one view group. The runtime implementation was removed when
 * `WindowGroup` / `WidgetBoard` became the owners; the frame still consumes
 * these shapes from `FrameViewGroup`.
 *
 * @module prac-client-ui-frame/client/viewGroup
 */

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

/** One member's placement as the frame sees it. */
export interface ViewGroupPlacement {
  readonly viewId: string;
  readonly groupId: string;
  readonly order: number;
  readonly active: boolean;
  readonly visible: boolean;
}
