/**
 * Serializable snapshot contract for a layout + binding session.
 *
 * @module prac-ui-kit-content/snapshot
 */

import type { GeometryNode } from "prac-ui-kit-layout";

/** Current snapshot version. Bump when the shape changes incompatibly. */
export const UI_KIT_SNAPSHOT_VERSION = 1;

/** Persisted geometry and bindings. Bindings are ids, not live objects. */
export interface UiKitSnapshot {
  readonly version: number;
  readonly geometry: GeometryNode;
  readonly bindings?: Readonly<Record<string, string>>;
}
