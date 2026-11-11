/**
 * The board: prac's own composition of widgets.
 *
 * The extension contributes widgets; the board is prac's, so a widget set can be
 * split and recombined without the extension having to know. `boardId` on the
 * widget is the current (unique) home; `defaultBoard` is only the first landing.
 *
 * @module prac-client-ui-widget/client/board-types
 */

/** One board's declaration (prac core). */
export interface PracBoardDef {
  readonly id: string;
  readonly title: string;
  /** The app that opens this board's window. */
  readonly appId: string;
  readonly defaultRegion?: string;
}

/** A board's runtime: its widgets, its active one, and whether the dock shows it. */
export interface PracBoard {
  readonly def: PracBoardDef;
  /** Active widget id. */
  readonly active?: string;
  /** Whether the dock shows this board. */
  readonly pinned: boolean;
}
