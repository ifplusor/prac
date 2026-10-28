/**
 * `prac-web-app` is now a composition facade.
 *
 * The workbench plugin body lives in `prac-client-ui-workbench`; this package
 * keeps the DSH bundle id and re-exports its plugin entry.
 *
 * @module prac-web-app/client
 */

export { apply, inject, name } from "prac-client-ui-workbench/client";
