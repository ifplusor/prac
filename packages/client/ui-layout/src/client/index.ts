/**
 * `ui-layout` is now a compatibility facade.
 *
 * The frame, slot declarations and geometry live in `prac-client-ui-frame`; this
 * package keeps the DSH bundle id and re-exports the plugin entry for the
 * composition.
 *
 * @module prac-client-ui-layout/client
 */

export { apply, inject, name } from "prac-client-ui-frame/client";
export * from "prac-client-ui-frame/client";
