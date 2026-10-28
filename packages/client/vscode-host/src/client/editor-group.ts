/**
 * The boundary between an **editor group** and a prac **window group**.
 *
 * VS Code's editor groups are how the embedded app splits its editors; prac's
 * window groups are how the shell splits windows of *any* app. The two are
 * mapped onto each other (a group is a region), but they are not the same
 * thing: when an editor group becomes empty the editor's lifecycle asks prac to
 * remove the region, and that is only correct while the group holds nothing but
 * editors. A window group that also holds the conversation is not empty just
 * because its last editor moved elsewhere — removing it would delete the chat
 * with it, which is what made the centre group (and the conversation) vanish
 * after a file was split out.
 *
 * @module prac-client-vscode-host/client/editor-group
 */

/** The part of a view record this decision needs. */
export interface WindowRegionRecord {
  readonly region: string;
  readonly hidden?: boolean;
}

/**
 * Whether a region (or one of its container children) still holds a window that
 * the editor does not own.
 *
 * Hidden windows count: putting a window away is not closing it, and it would
 * come back to a region the editor has already removed.
 *
 * @param views - the frame's view table.
 * @param region - the region the editor group says is now empty.
 * @param isEditorView - whether a view id belongs to the editor app.
 * @returns true when some non-editor window still lives in the region.
 */
export function regionHoldsOtherWindow(
  views: Readonly<Record<string, WindowRegionRecord>>,
  region: string,
  isEditorView: (viewId: string) => boolean,
): boolean {
  const inRegion = (candidate: string): boolean =>
    candidate === region || candidate.startsWith(`${region}/`);
  return Object.entries(views).some(
    ([viewId, record]) => !isEditorView(viewId) && inRegion(record.region),
  );
}
