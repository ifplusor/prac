/**
 * Generic container chrome.
 *
 * A container (frame or board) supplies its control surfaces; the registry
 * places them at the renderer's anchors. The builder is generic over the item
 * record, so the frame can use `PlacementRecord` and a board `WidgetRecord` without
 * either container inheriting the other's chrome.
 *
 * @module prac-ui-kit-content/container-chrome
 */
import type { ReactNode } from "react";
import { ChromeRegistry } from "./chrome.js";
import type { ChromeAnchor, ChromeContext } from "./chrome.js";
import type { PlacementRecord } from "./placement.js";

/** The control surfaces a container renders into the renderer's anchors. */
export interface ContainerChromeParts<TRecord extends PlacementRecord> {
  readonly renderTabs: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderContainerBar: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderRowHeader: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderRowOverlay: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderSash: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderGridCell: (ctx: ChromeContext<TRecord>) => ReactNode;
  readonly renderGridTrack: (ctx: ChromeContext<TRecord>) => ReactNode;
}

/** Every anchor, in the order a registry copy visits them. */
const ANCHORS: readonly ChromeAnchor[] = [
  "region.frame",
  "region.tabs",
  "region.header",
  "region.footer",
  "row.header",
  "region.overlay",
  "split.sash",
  "grid.cell",
  "grid.track",
];

/**
 * Assemble a container's chrome.
 *
 * @param parts - the container-rendered control surfaces.
 * @param base - contributions another container registered first (optional).
 * @returns a registry the renderer can read.
 */
export function createContainerChrome<TRecord extends PlacementRecord>(
  parts: ContainerChromeParts<TRecord>,
  base?: ChromeRegistry<TRecord>,
): ChromeRegistry<TRecord> {
  const chrome = new ChromeRegistry<TRecord>();
  if (base !== undefined) {
    for (const anchor of ANCHORS) for (const item of base.list(anchor)) chrome.add(item);
  }
  chrome.add({ id: "frame.tabs", anchor: "region.tabs", order: 10, render: parts.renderTabs });
  chrome.add({
    id: "frame.container",
    anchor: "region.header",
    order: 10,
    render: parts.renderContainerBar,
  });
  chrome.add({
    id: "frame.row.header",
    anchor: "row.header",
    order: 10,
    render: parts.renderRowHeader,
  });
  chrome.add({
    id: "frame.row.overlay",
    anchor: "region.overlay",
    order: 10,
    render: parts.renderRowOverlay,
  });
  chrome.add({ id: "frame.sash", anchor: "split.sash", order: 10, render: parts.renderSash });
  chrome.add({
    id: "frame.grid.cell",
    anchor: "grid.cell",
    order: 10,
    render: parts.renderGridCell,
  });
  chrome.add({
    id: "frame.grid.track",
    anchor: "grid.track",
    order: 10,
    render: parts.renderGridTrack,
  });
  return chrome;
}
