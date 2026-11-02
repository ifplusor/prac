/**
 * The layout store contract, re-exported from `prac-ui-kit-content`.
 *
 * The frame's store fixes the record type to `ViewRecord` (window / widget);
 * a board still uses the generic content store / hook over its own record type.
 *
 * @module prac-ui-kit-frame/store
 */

import type { LayoutStore as ContentLayoutStore } from "prac-ui-kit-content";
import type { ViewRecord } from "./contract.js";

/** The frame's layout store: the content store specialised to `ViewRecord`. */
export interface LayoutStore extends ContentLayoutStore<ViewRecord> {}

export { useLayout } from "prac-ui-kit-content";
export { createSwitchingStore, type SwitchingStore } from "prac-ui-kit-content";
