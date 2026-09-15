/**
 * prac-web-app — the bundle and its arrangement.
 *
 * This package is the **bundle**: its `cordis.patch.yml` is the composition
 * (disable DSH's `ui-layout`, mount the frame mechanism, the shared VS Code
 * client mechanism, the two seats and the VS Code host gateway), and its
 * client half (`src/client.ts` → `dist/client.js`) is the arrangement that says
 * what is on screen and where.
 *
 * The host half does no work: the arrangement is browser-only, and the
 * `/prac-vscode` route belongs to `prac-host-vscode` with the rest of the
 * VS Code side. The composition still needs a host-side entry because every
 * bundle row is imported on both planes, so this module exists to be that entry
 * and deliberately does nothing.
 *
 * @module prac-web-app
 */

/** No host-side behavior. */
export function apply(): void {}
