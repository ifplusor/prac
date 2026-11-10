/**
 * Host half of the document-preview app.
 *
 * The app is a browser concern: its windows and preview bodies live in the
 * client bundle. Every bundle row is imported on both planes, so this module
 * exists to be the host entry and deliberately does nothing.
 *
 * @module prac-client-ui-document-preview
 */

/** No host-side behavior. */
export function apply(): void {}
