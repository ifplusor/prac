/**
 * Target-first move for a view runtime.
 *
 * The source is not released until the target has a mounted host. A failed
 * target leaves the source exactly as it was; the default `createHost` path is
 * the source adapter's responsibility, so state-preserving moves are an
 * optimization rather than a core guarantee.
 *
 * @module prac-client-ui-frame/client/move
 */

import type { MoveIntent, ViewHost } from "./contracts.js";
import { View } from "./view.js";
import type { ViewGroup } from "./viewGroup.js";

/** Inputs for one target-first move. */
export interface MoveViewRequest {
  readonly viewId: string;
  readonly from: ViewGroup;
  readonly to: ViewGroup;
  readonly element: HTMLElement;
  readonly intent: MoveIntent;
  /** Source-owned host factory; the intent is only a hint. */
  createHost(viewId: string, intent: MoveIntent): ViewHost;
}

/**
 * Move one view between view groups.
 *
 * Order:
 * 1. create and mount the target `ViewHost`;
 * 2. remove the source view and release its host;
 * 3. on failure, remove the target view and leave the source intact.
 */
export function moveView(request: MoveViewRequest): void {
  const { viewId, from, to, element, intent } = request;
  if (from === to) throw new Error(`cannot move a view within itself: ${viewId}`);
  if (!from.has(viewId)) throw new Error(`source has no view: ${viewId}`);
  if (to.has(viewId)) throw new Error(`target already has view: ${viewId}`);

  const targetView = new View(viewId);
  to.add(targetView);
  try {
    targetView.mount(request.createHost(viewId, intent), element);
  } catch (cause) {
    to.remove(viewId);
    throw cause;
  }
  from.remove(viewId);
}
