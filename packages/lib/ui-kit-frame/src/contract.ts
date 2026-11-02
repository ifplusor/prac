/**
 * The layout vocabulary: the region/split tree, the views table's shapes, and the
 * faces this mechanism publishes.
 *
 * Layer 0 of the client half — it imports nothing from the other domains, so
 * every module (model, store, frame, services) can speak these types without
 * depending on each other.
 *
 * @module prac-ui-kit-frame/contract
 */

import type { Box } from "prac-ui-kit-layout";
export type {
  Box,
  Dir,
  GridNode,
  GridPlacement,
  LayoutNode,
  LayoutPriority,
  RegionChild,
  RegionNode,
  RegionSelector,
  Side,
  Sizing,
  SplitNode,
  TabMode,
} from "prac-ui-kit-layout";
import type { LayoutState as ContentLayoutState, PlacementRecord } from "prac-ui-kit-content";
export type { ViewFlags } from "prac-ui-kit-content";

// This file is DSH-free on purpose: the kit only speaks layout vocabulary. The
// `SlotMap` / `Context` merges that bind prac's slots and faces to DSH live in
// the frame plugin's contract, which names DSH on the plugin's behalf.

/** Split axis: `row` distributes width, `column` distributes height. */
/** Where one view sits, and in what order inside its region. */
/** Whether a frame view is a window or a widget. */
export type FrameViewKind = "window" | "widget";

interface ViewRecordBase extends PlacementRecord {
  /** Content host id; when present the frame renders the host, not a slot. */
  contentId?: string;
  /** Region id used as this window's nested content. */
  contentRegion?: string;
  /** Board id whose LayoutState<WidgetRecord> renders this window. */
  boardId?: string;
}

/** A record proven to be a window. */
export interface WindowRecord extends ViewRecordBase {
  kind: "window";
}

/** A record proven to be a widget. */
export interface WidgetRecord extends ViewRecordBase {
  kind: "widget";
}

/** The discriminated record union. */
export type ViewRecord = WindowRecord | WidgetRecord;
/** Compatibility alias for code that only needs the discriminated union. */
export type TypedViewRecord = ViewRecord;

export function isWindowRecord(record: ViewRecord): record is WindowRecord {
  return record.kind === "window";
}

export function isWidgetRecord(record: ViewRecord): record is WidgetRecord {
  return record.kind === "widget";
}

export interface LayoutState<
  TRecord extends ViewRecord = ViewRecord,
> extends ContentLayoutState<TRecord> {}

/** Inline style values this frame emits. */
export type StyleObject = Record<string, string | number>;

/** A box standing in for a region the resolver has not measured yet. */
export const ZERO_BOX: Box = { width: 0, height: 0 };

/** Width/height of a sash's hit area in px (VS Code: `--vscode-sash-size` 4). Kept in step with FRAME_STYLES. */
export const SASH_SIZE = 4;
/** A region's minimum size in px unless it declares its own. */
export const DEFAULT_MIN = 120;
/** The centre work area stays wider than a side track can usefully be. */
export const CENTER_MIN = 240;
/**
 * The frame's default centre region.
 *
 * Where a main panel goes when the arrangement placed it nowhere: the centre is
 * the frame's own default, and the arrangement is free to place the same view
 * somewhere else (see the placement face's `selectPanel`).
 */
export const CENTER_REGION = "center";
/**
 * The frame's bottom bar.
 *
 * It sits under the whole row of side regions — the home of a terminal, output,
 * problems: things that are about the workspace rather than about one region.
 * It is empty at boot, and an empty region is not rendered at all, so the
 * default layout is exactly the row; the arrangement (or the user) fills it.
 */
export const BOTTOM_REGION = "bottom";
