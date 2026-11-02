/**
 * The workbench layout store contract.
 *
 * The frame's store fixes the record type to `ItemRecord` (window / widget);
 * a board still uses the generic content store / hook over its own record type.
 *
 * @module prac-ui-kit-workbench/store
 */

import type { LayoutStore as ContentLayoutStore } from "prac-ui-kit-content";
import type { ItemRecord } from "./contract.js";

/** The frame's layout store: the content store specialised to `ItemRecord`. */
export interface LayoutStore extends ContentLayoutStore<ItemRecord> {}
