/**
 * The client half of `ui-changed-files`: the loader entry and the package's public module.
 *
 * The card and its styles are internal; the feature reaches the page through the
 * `conversation.chat.turnTail` slot it registers in `apply`.
 *
 * @module prac-client-ui-changed-files/client
 */

export { apply, inject, name } from "./service.js";
