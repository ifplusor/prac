/**
 * Host half of `ui-surface`.
 *
 * Surface contracts and isolation are browser-only; the composition still needs
 * a host-side entry because every workspace package is imported on both planes.
 *
 * @module prac-client-ui-surface
 */

/** No host-side behavior. */
export function apply(): void {}
