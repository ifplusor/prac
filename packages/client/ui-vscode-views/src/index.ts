/**
 * Host half of prac's VS Code views package.
 *
 * The client half is a browser-only concern: it declares `prac.widget` entries from the
 * app's view catalogue, which only exists in the page where the app is booted.
 * The composition still needs a host-side entry because every bundle row is
 * imported on both planes, so this module exists to be that entry and
 * deliberately does nothing.
 *
 * @module prac-client-ui-vscode-views
 */

/** No host-side behavior. */
export function apply(): void {}
