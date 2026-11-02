/**
 * The client half of `ui-dsh`: the loader entry and the package's public module.
 *
 * The vocabulary and the mapping helpers are internal (`dsh.ts`); consumers
 * reach them through the `ctx.pracDsh` service, and take the face type from
 * `prac-client-ui-dsh/client`.
 *
 * @module prac-client-ui-dsh/client
 */

export { apply, inject, name } from "./service.js";
