/**
 * Host half of prac's layout.
 *
 * The layout is a browser-only concern: the frame, the placement model and the
 * theme presenter all live in the client bundle (`src/client.ts` → `dist/client.js`).
 * The composition still needs a host-side entry because every bundle row is
 * imported on both planes, so this module exists to be that entry and
 * deliberately does nothing.
 *
 * @module prac-client-vscode-host
 */

/** No host-side behavior. */
export function apply(): void {}
