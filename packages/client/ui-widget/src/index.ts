/**
 * Host half of `ui-widget`.
 *
 * Widget descriptors and registries are browser-only; the composition still
 * needs a host-side entry because every workspace package is imported on both
 * planes.
 *
 * @module prac-client-ui-widget
 */

/** No host-side behavior. */
export function apply(): void {}
