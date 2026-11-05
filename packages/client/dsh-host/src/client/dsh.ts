/**
 * DSH slot vocabulary and the small mapping helpers prac needs.
 *
 * This package is the DSH source adapter surface; the workbench consumes these
 * names instead of restating DSH's slot ids.
 *
 * @module prac-client-dsh-host/client/dsh
 */

/** DSH's sidebar slot as a prac view id. */
export const DSH_SIDEBAR_VIEW = "dsh:sidebar";
/** DSH's rightbar slot as a prac view id. */
export const DSH_RIGHTBAR_VIEW = "dsh:rightbar";
/** DSH's keyed `main` prefix. */
export const DSH_MAIN_PREFIX = "dsh:main:";
/** The conversation key inside `main`, as a prac view id. */
export const DSH_CONVERSATION_VIEW = `${DSH_MAIN_PREFIX}conversation`;

/** Build the prac view id for one `main` key. */
export function dshMainView(key: string): string {
  return `${DSH_MAIN_PREFIX}${key}`;
}

/** Extract a `main` key from a prac view id, or `undefined` for another slot. */
export function dshMainKey(viewId: string): string | undefined {
  return viewId.startsWith(DSH_MAIN_PREFIX) ? viewId.slice(DSH_MAIN_PREFIX.length) : undefined;
}
