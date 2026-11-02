/**
 * The target window / board / widget model.
 *
 * This module names the product objects. A window owns a content host, a board
 * owns widgets, and a widget is a child of a board — none of them is a generic
 * "view"; the view vocabulary belongs to the source adapters.
 *
 * `WidgetBoardGroup` is gone; a board is the content of one window (`BoardWindow`).
 * `BoardWindowAdapter` composes that window with the generic `WindowGroupModel`
 * when other windows are hosted beside it.
 *
 * @module prac-ui-kit-workbench/windowModel
 */

export type { LayoutRoot, LayoutRootKind } from "./layoutRoot.js";
import type {
  ContentGroup,
  ContentGroupState,
  ContentItem,
  ContentPlacement,
} from "prac-ui-kit-content";

/** What a window renders: product-defined string. */
export type WindowContentKind = string;

/** A mounted content host. The frame owns the element; the source owns the content. */
export interface ContentHost {
  /** Stable identity, matching the window / widget id. */
  readonly id: string;
  /** Mount into the frame-provided element. */
  mount(element: HTMLElement): void;
  /** Release the host without disposing its source-owned identity. */
  release(): void;
  /** Ask the host to take focus when it supports it. */
  focus?(): void;
}

/** One child of a board. */
export interface WidgetHost extends ContentHost {
  /** The widget's source vocabulary (`vscode` / `dsh` / …), for diagnostics only. */
  readonly source?: string;
}

/** The content of a board window. */
export interface BoardContent extends ContentHost {
  readonly kind: "board";
  /** Widgets in board order. */
  readonly widgets: readonly WidgetHost[];
  /** The active widget id. */
  readonly activeWidget: string | undefined;
  /** Replace the widget order / active without recreating the board. */
  setPlacement(order: readonly string[], active: string | undefined): void;
}

/** One window instance. */
export interface Window extends ContentItem<ContentHost & { readonly kind: WindowContentKind }> {
  /** The app / content identity that opened this window. */
  readonly appId: string;
}

/** How a group presents its members. */
export type WindowGroupMode = "stack" | "select";

/** One member's placement as the group sees it. */
export interface WindowGroupPlacement extends ContentPlacement {
  readonly itemId: string;
  readonly groupId: string;
  readonly order: number;
  readonly active: boolean;
  readonly visible: boolean;
  /**
   * Whether the group owns the window's record.
   *
   * A group may **host** a window another owner manages (an editor window the
   * workbench placed in a sidebar region, say): the projection follows it while it
   * is a member, but losing the membership must not delete the record — the owner
   * still has that window. Absent means owned.
   */
  readonly owned?: boolean;
}

/** One action a group bar may render. */
export interface WindowGroupAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly tooltip?: string;
  readonly submenu?: readonly WindowGroupAction[];
}

/** A source-specific group binding. */
export interface WindowGroupBinding {
  dispose(): void;
}

/** A group binding that can also drive its title bar. */
export interface WindowGroupActionBinding extends WindowGroupBinding {
  actions(): readonly WindowGroupAction[];
  runAction(actionId: string): void;
}

/** The runtime group contract the frame consumes. */
export interface WindowGroupState extends ContentGroupState {
  readonly mode: WindowGroupMode;
  readonly order: readonly string[];
}

/** The structural runtime shape the frame consumes. */
export interface WindowGroup extends ContentGroup<Window, WindowGroupPlacement> {
  readonly state: WindowGroupState;
  readonly binding?: WindowGroupBinding;
  readonly windows?: readonly Window[];
  setBinding?(binding: WindowGroupBinding | undefined): void;
}

/** Whether a content host is a board. */
export function isBoardContent(content: ContentHost): content is BoardContent {
  return (content as BoardContent).kind === "board";
}
