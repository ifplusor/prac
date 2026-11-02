/**
 * The client half of `ui-widget`: the loader entry and the package's public module.
 *
 * Boards, widgets and the service implementation are internal; consumers reach
 * them through `ctx.pracWidgets`, and take the face type from
 * `prac-client-ui-widget/client`.
 *
 * @module prac-client-ui-widget/client
 */

export { apply, inject, name } from "./service.js";
