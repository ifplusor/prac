/**
 * `ui-frame` is a DSH plugin row, not a library.
 *
 * The host half is empty (this entry, `apply` only); the browser half is the
 * loader artifact (`./client`), whose `types` condition is generated from
 * `src/client/contract.ts`. Consumers name `prac-client-ui-frame/client`
 * type-only for the `SlotMap` / `Context` merges. The layout model / renderer
 * itself lives in `prac-ui-kit-workbench`.
 *
 * @module prac-client-ui-frame
 */

/** No host-side behavior. */
export function apply(): void {}
