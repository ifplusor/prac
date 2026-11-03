/**
 * The frame's item catalogue: slots ∪ app windows, joined with placement.
 *
 * Pure on purpose: the union of "what the slot registry declares" and "which app
 * windows are admitted" is the seam an architecture change tends to break (a
 * window that disappears from the catalogue, or a stale one that stays), and it
 * should be decidable without a browser.
 *
 * @module prac-client-ui-frame/client/catalogue-items
 */

import type { ItemRecord, LayoutState } from "prac-ui-kit-workbench";

import type { ItemInfo } from "./contract.js";

/**
 * Build the item list the frame's face reports.
 *
 * @param state - the layout state (placement per item).
 * @param slotIds - ids the slot registry currently declares.
 * @param windowIds - ids of windows an app admitted.
 * @param kindOf - the kind a declaration reports, when it reports one.
 * @returns one entry per known item, slots first.
 */
export function listCatalogueItems(
  state: LayoutState,
  slotIds: readonly string[],
  windowIds: readonly string[],
  kindOf: (id: string) => "window" | "widget" | undefined,
): ItemInfo[] {
  const ids = new Set([...slotIds, ...windowIds]);
  return [...ids].map((id) => {
    const record: ItemRecord | undefined = state.items[id];
    if (record === undefined) {
      return {
        id,
        region: null,
        hidden: true,
        order: null,
        kind: kindOf(id) === "widget" ? "widget" : "window",
      };
    }
    return {
      id,
      region: record.region,
      hidden: record.hidden,
      order: record.order,
      // The record's kind wins: a placed widget the board owns still has a window
      // record only when the frame placed it, so the record is the local truth.
      kind: record.kind,
    };
  });
}
