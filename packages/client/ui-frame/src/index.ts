/**
 * Host half of `ui-frame`.
 *
 * Frame geometry is browser-only; the composition still needs a host-side
 * entry because every workspace package is imported on both planes.
 *
 * @module prac-client-ui-frame
 */

/** No host-side behavior. */
export function apply(): void {}
