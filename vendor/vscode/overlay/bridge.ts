/**
 * Embed bridge contract: the single definition of the channel between an
 * *embedder* of this patched build and the composition this package installs
 * into it.
 *
 * The channel runs one way at boot: the embedder hands the workbench a bridge
 * object through VS Code's own construction options
 * (`IWorkbenchConstructionOptions`), and the workbench side — which runs inside
 * the workbench bundle, outside the embedder's module graph — uses it to hand
 * back the face that mounts parts into the embedder's regions.
 *
 * This file is deliberately **dependency-free** (no imports, no DOM types): the
 * upstream build compiles it too. The overlay build places a copy of it into the
 * checkout as `src/vs/workbench/browser/embedBridge.ts`, so both sides read the
 * same constants and the options field name is spelled exactly once. Do not add
 * imports here; do not re-spell the field name anywhere else.
 *
 * @module embed-bridge
 */

/** The construction-options field an embedder hands the workbench its bridge on. */
export const EMBED_BRIDGE = "vscodeEmbed";

/**
 * The attribute that marks a part host element, carrying the part id it hosts.
 *
 * Optional composition: a host carrying it is where that part is mounted; parts
 * without one stay in the workbench's own container. Written by the embedder's
 * shell and read by {@link PartHostFace}'s implementation, so it is spelled here
 * once and imported by both.
 */
export const PART_HOST_ATTR = "data-vscode-embed-part-host";

/**
 * The workbench-side face, valid once the workbench's service graph has
 * restored.
 *
 * The members are function-typed properties, not methods: the workbench side
 * publishes arrow functions closing over its instance, so a reference held
 * unbound keeps working. Parts are single instances bound to their services, so
 * the embedder *moves* one between hosts and never recreates it.
 */
export interface PartHostFace {
  /**
   * Create a registered part into an external host element.
   *
   * @param partId - the workbench part id (`workbench.parts.editor`).
   * @param element - the host element the embedder rendered for it.
   */
  mountPartInto: (partId: string, element: HTMLElement) => void;
  /**
   * Move an already-mounted part into another host element (re-parenting, not
   * recreating).
   *
   * @param partId - the workbench part id.
   * @param element - the new host element.
   */
  movePartInto: (partId: string, element: HTMLElement) => void;
  /**
   * Create a registered view into an external host element.
   *
   * The view is created as **its own pane** — header and body into its own
   * element — rather than through its view container: grouping (activity bar,
   * ordering, drag and drop between views) is the embedder's business, and a
   * view can therefore live outside any part. The same view mounted twice
   * re-uses the pane it already has.
   *
   * @param viewId - the view id (`workbench.explorer.fileView`).
   * @param element - the host element the embedder rendered for it.
   */
  mountViewInto: (viewId: string, element: HTMLElement) => void;
  /**
   * Dispose a view created by {@link PartHostFace.mountViewInto}, so the same
   * view can be created again (elsewhere, or after its host went away).
   *
   * @param viewId - the view id.
   */
  releaseView: (viewId: string) => void;
  /**
   * Mount **one file's editing surface** into an external host element.
   *
   * The unit is the file, not the editor part: the embedder decides which files
   * are open, groups them, and draws the tab strip, so what it needs from the
   * workbench is a single file's editing control — the workbench's own text
   * model (so language features, undo/redo and saving are the real ones) in a
   * `CodeEditorWidget`, which is how the workbench itself builds an editor
   * control (`TextCodeEditor.createEditorControl`). No editor part, no editor
   * group, no tab strip: those are the embedder's composition.
   *
   * The resource is the workbench's own URI as a string
   * (`vscode-remote://<authority>/<path>`, or a bare path for a local file) —
   * the same vocabulary {@link PartHostFace.openWorkspaceFolder} takes, because
   * the embedder cannot construct a `URI` instance.
   *
   * One editing surface per resource: mounting a resource that is already
   * mounted re-parents it (a file has one model, and a second editor for it
   * would be a second view of the same text).
   *
   * @param resource - the file's URI, as a string.
   * @param element - the host element the embedder rendered for it.
   */
  mountFileInto: (resource: string, element: HTMLElement) => void;
  /**
   * Dispose the editing surface created by {@link PartHostFace.mountFileInto},
   * so the same file can be mounted again (elsewhere, or after its host went
   * away). The workbench's text model survives while anything else references
   * it.
   *
   * @param resource - the file's URI, as a string.
   */
  releaseFile: (resource: string) => void;
  /**
   * The resources the workbench currently has open, in its own order.
   *
   * The embedder owns *rendering* files (see
   * {@link PartHostFace.mountFileInto}), so it needs to know which files the
   * app considers open — opening one from the app's own UI (an explorer click, a
   * command, a jump) has to become a view, or the app would be editing files
   * nobody can see.
   *
   * @returns one URI string per open file.
   */
  listOpenFiles: () => string[];
  /**
   * Subscribe to changes in the open-file set.
   *
   * Fires after the set actually changed (not on every editor activation), so a
   * listener can re-read {@link PartHostFace.listOpenFiles} and reconcile.
   *
   * @param listener - called when the open-file set changed.
   * @returns a function that unsubscribes.
   */
  onDidChangeOpenFiles: (listener: () => void) => () => void;
  /**
   * Open an untitled editor.
   *
   * @param path - optional path the untitled buffer is named after.
   */
  openUntitled: (path?: string) => void;
  /**
   * Enter a folder as the workbench's workspace.
   *
   * The public `vscode.openFolder` command cannot be driven from the embedder
   * (its first argument is validated against a `URI` instance the page cannot
   * construct), so the workbench side opens it with the `URI` it holds.
   *
   * @param folderUri - `vscode-remote://<authority>/<path>`, or a bare path.
   */
  openWorkspaceFolder: (folderUri: string) => void;
  /** The current workspace identity, for diagnostics. */
  workspaceInfo: () => unknown;
}

/** What an embedder hands the workbench at boot. */
export interface EmbedBridge {
  /**
   * Whether the embedder's shell mounts the parts itself.
   *
   * `true` (an embedder that renders its own part hosts): the workbench mounts
   * nothing on its own and publishes {@link PartHostFace} through
   * {@link EmbedBridge.publish}. `false`/absent (a page that wants the workbench
   * composed by its own containers, e.g. `vendor/vscode/overlay/page.html`): the
   * workbench mounts each part into the document host carrying
   * {@link PART_HOST_ATTR} for its part id, or into its own container when there
   * is none.
   */
  readonly deferParts: boolean;
  /**
   * Receive the workbench-side face.
   *
   * Called from inside the workbench once its service graph has restored — well
   * after `create()` returned — which is why the face travels this way instead
   * of being a return value.
   *
   * @param face - the part-hosting face.
   */
  publish(face: PartHostFace): void;
}

/**
 * Read the bridge out of a construction-options object.
 *
 * Validates instead of trusting: the options object is a plain object owned by
 * the embedder, so a malformed bridge must read as "no bridge" (the workbench
 * then composes itself into the document hosts, as it does on the standalone
 * page) rather than as a half-applied one.
 *
 * @param options - the workbench's construction options (`IBrowserWorkbenchEnvironmentService.options`).
 * @returns the bridge, or `undefined` when none was handed over.
 */
export function readEmbedBridge(options: unknown): EmbedBridge | undefined {
  const raw = (options as Record<string, unknown> | undefined)?.[EMBED_BRIDGE];
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as { deferParts?: unknown; publish?: unknown };
  if (typeof candidate.publish !== "function") return undefined;
  return {
    deferParts: candidate.deferParts === true,
    publish: candidate.publish as (face: PartHostFace) => void,
  };
}
