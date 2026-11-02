/**
 * The frame's default chrome.
 *
 * The frame is a container of `LayoutRenderer`: it supplies the item renderer,
 * the allocation and this registry. Each contribution forwards to a frame-owned
 * control surface; the renderer decides where the anchor sits.
 *
 * @module prac-client-ui-frame/client/frameChrome
 */
import type { ChromeRegistry } from "prac-ui-kit-workbench";
import type { ItemRecord } from "prac-ui-kit-workbench";
import { createContainerChrome, type ContainerChromeParts } from "prac-ui-kit-workbench";

/** The control surfaces the frame renders into the renderer's anchors. */
export type FrameChromeParts = ContainerChromeParts<ItemRecord>;

/**
 * Assemble the frame's chrome.
 *
 * @param parts - the frame-rendered control surfaces.
 * @param base - contributions another container registered first (optional).
 * @returns a registry the renderer can read.
 */
export function createFrameChrome(
  parts: FrameChromeParts,
  base?: ChromeRegistry<ItemRecord>,
): ChromeRegistry<ItemRecord> {
  return createContainerChrome(parts, base);
}
