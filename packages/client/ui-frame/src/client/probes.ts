/**
 * The page-level probe surface the live gates reach the client model through.
 *
 * A driver script runs in the page, where the bundle's `require` resolves only
 * registered bundle ids — it cannot reach the Cordis context. Publishing the
 * faces on `globalThis` is the honest door, and this module owns it: the shape
 * is declared once, publication is one call, and removal is scoped to the
 * instance that published it.
 *
 * Adding a probe is adding a field here (and its reader in the gate), not
 * another ad-hoc global with its own declaration, publish and cleanup.
 *
 * @module prac-client-ui-frame/client/probes
 */

import type { BoardLayoutRegistry } from "prac-ui-kit-workbench";

import type { PracLayoutFace, PracSpacesFace, PracWindowActionsFace } from "./contract.js";

/** The faces a gate reads from the page. */
export interface PracProbes {
  /** The placement model: items, regions, placement and front. */
  readonly frame: PracLayoutFace;
  /** The board layout registry (a board's state is not in the frame's item table). */
  readonly boardLayouts: BoardLayoutRegistry;
  /** The Space registry. */
  readonly spaces: PracSpacesFace;
  /**
   * The window-action models, keyed by view.
   *
   * Gates wait on the **model event** (`subscribe` + `get`) rather than on the
   * rendered buttons: a tab strip can be present a frame before its actions are
   * published, and waiting on the DOM then measures the renderer's timing.
   */
  readonly windowActions: PracWindowActionsFace;
}

declare global {
  /**
   * The probe surface, published by the `prac-client-ui-frame` instance that is
   * installed and removed by the same instance.
   */
  var __pracTest: PracProbes | undefined;
}

/**
 * Publish the probe surface for the page's drivers.
 *
 * @param probes - the faces this instance publishes.
 * @returns cleanup that only removes the object if this instance still owns it.
 */
export function publishPracProbes(probes: PracProbes): () => void {
  globalThis.__pracTest = probes;
  return () => {
    if (globalThis.__pracTest === probes) delete globalThis.__pracTest;
  };
}
