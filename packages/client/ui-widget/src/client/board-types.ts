/**
 * The board: prac's own composition of widgets.
 *
 * The extension contributes widgets; the board is prac's, so a widget set can be
 * split and recombined without the extension having to know. `boardId` on the
 * widget is the current (unique) home; `defaultBoard` is only the first landing.
 *
 * @module prac-client-ui-widget/client/board-types
 */

import type { LayoutState } from "prac-ui-kit-content";

/** One board's declaration (prac core). */
export interface PracBoardDef {
  readonly id: string;
  readonly title: string;
  /** The app that opens this board's window. */
  readonly appId: string;
  readonly defaultRegion?: string;
}

/** A board's runtime: its widgets, its layout, its active one, and whether the dock shows it. */
export interface PracBoard {
  readonly def: PracBoardDef;
  /** The board's widgets, in tab order; the membership authority. */
  readonly widgets: readonly string[];
  /** Position, geometry and visibility of the board's widgets. */
  readonly root: LayoutState;
  /** Active widget id. */
  readonly active?: string;
  /** Whether the dock shows this board. */
  readonly pinned: boolean;
}
