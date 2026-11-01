/**
 * The workspace scope for layout persistence.
 *
 * prac is a workspace-scoped workbench: a project folder has its own Spaces and
 * its own layout. The page's `?workspace=` is the same connection-level choice
 * the code server boots from (and the switcher reloads the page with it), so it
 * is the stable identity available to the frame before any workspace service is
 * injected.
 *
 * The key is a hash, in the spirit of VS Code's `workspaceStorage/<hash>`: the
 * path can contain separators and spaces, and a short derived key keeps the
 * localStorage keys readable.
 *
 * @module prac-client-ui-frame/client/workspace-scope
 */

/** The scope used before a project folder is chosen (first-run). */
export const NO_WORKSPACE_SCOPE = "no-workspace";

/**
 * Derive the persistence scope from a page's query string.
 *
 * @param search - `window.location.search`, including the leading `?`.
 * @returns a stable scope key; `no-workspace` when no folder is selected.
 */
export function workspaceScope(search: string): string {
  const path = new URLSearchParams(search).get("workspace");
  if (path === null || path === "") return NO_WORKSPACE_SCOPE;
  // The same folder with and without a trailing slash is the same workspace.
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
