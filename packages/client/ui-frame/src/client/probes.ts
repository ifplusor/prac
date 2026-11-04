/**
 * The probe surface the live gates read the frame's model through.
 *
 * The faces are published through the kit's registry (`publishProbe`): one
 * object, `globalThis.__pracTest`, one entry per name, instance-scoped cleanup.
 * A driver script runs in the page and cannot reach the Cordis context, so this
 * is the door — but adding a probe is a field here plus a reader in the gate, not
 * another ad-hoc global.
 *
 * @module prac-client-ui-frame/client/probes
 */

import { publishProbe } from "prac-ui-kit-workbench/probes";

import type { PracLayoutFace, PracSpacesFace, PracWindowActionsFace } from "./contract.js";
import type { BoardLayoutRegistry } from "prac-ui-kit-workbench";

/** The faces this plugin publishes, by probe name. */
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

/**
 * Publish the frame's probes for the page's drivers.
 *
 * @param probes - the faces this instance publishes.
 * @returns cleanup for every field this instance published.
 */
export function publishPracProbes(probes: PracProbes): () => void {
  const disposers = Object.entries(probes).map(([name, value]) => publishProbe(name, value));
  return () => {
    for (const dispose of disposers) dispose();
  };
}
