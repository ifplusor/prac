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

export { EXTENSIONS_GALLERY } from "./extensionsGallery.js";

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
   * Open a file in the workbench, by the same string vocabulary as
   * {@link PartHostFace.mountFileInto}.
   *
   * The public `vscode.open` command cannot be driven from the embedder (its
   * argument is validated against a `URI` instance the page cannot construct), so
   * a path is opened through this instead. It goes through the editor service
   * exactly like an explorer click does, so it also shows up in
   * {@link PartHostFace.listOpenFiles} and becomes a view.
   *
   * @param resource - the file's URI, as a string.
   */
  openFile: (resource: string) => void;
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
  /**
   * The app's **capabilities**: its knowledge, addressed by name rather than by
   * which UI happens to be mounted.
   *
   * The hard criterion is that a capability works with **no view mounted at all**
   * — if it only answers while some part is on screen, the capability layer was
   * not actually separated from the UI.
   */
  readonly capabilities: {
    /** The open editor set (decision 21's first capability). */
    readonly editors: EditorsCapability;
    /** The problems the app knows about (the first capability with async data). */
    readonly diagnostics: DiagnosticsCapability;
  };
}

/**
 * One open editor, as both consumers see it.
 *
 * `resource` is the app's URI as a string (the embedder cannot construct a `URI`);
 * the rest is state the app owns. This is the shape the **UI** renders (a tab's
 * dirty dot, its preview italic) and the **agent** reads (what the user has open
 * and what is unsaved) — one snapshot, two consumers.
 */
export interface EditorEntry {
  /** The file's URI, as a string. */
  readonly resource: string;
  /** Whether this is the app's active editor. */
  readonly active: boolean;
  /** Whether the editor has unsaved changes. */
  readonly dirty: boolean;
  /** Whether the editor is in preview mode (replaced by the next preview open). */
  readonly preview: boolean;
}

/** What a consumer may do to the editor set. */
export interface EditorsActions {
  /**
   * Close an open file's editor.
   *
   * The action lives on the capability, not on the hosting face: closing is
   * something *done to the editor set*, and the embedder's views follow it (the
   * open-file event takes the view away with the editor).
   *
   * @param resource - the file's URI, as a string.
   */
  close(resource: string): void;
  /**
   * Make a file's editor the app's active one.
   *
   * The UI needs this because *its* notion of "current" is the front view in a
   * region: clicking a prac tab re-fronts a view, and unless the app's active
   * editor follows, the two disagree — the capability would report the wrong file
   * as active, and the tab the user just clicked would not be the one the app
   * considers current. Measured: without it, a tab click left the app on the
   * previously active editor while prac showed the clicked one.
   *
   * @param resource - the file's URI, as a string.
   */
  activate(resource: string): void;
}

/**
 * A capability: a named piece of the app's knowledge with **one handle for every
 * consumer**.
 *
 * The envelope is deliberately uniform, because the two consumers need different
 * things from the same data: the UI wants `snapshot` + `subscribe` (render now,
 * re-render on change), the agent wants `settled` + `version` + provenance (do not
 * act on half-settled state, and say which revision the answer is about). A
 * capability without those two is not one — it would hand a model a moment as if
 * it were a fact.
 */
export interface Capability<T, A> {
  /** The current value. */
  snapshot(): T;
  /**
   * Subscribe to changes.
   *
   * @param listener - called after a change; re-read `snapshot`.
   * @returns a function that unsubscribes.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Resolve when the async sources behind this capability have caught up.
   *
   * `editors` is synchronous workbench state, so this resolves at once — the
   * envelope is uniform on purpose, and a capability whose data *is* async (a
   * language server's diagnostics) is where this earns its keep.
   */
  settled(): Promise<void>;
  /** A monotonic revision of the snapshot, for provenance. */
  version(): number;
  /** The actions this capability allows. */
  readonly actions: A;
}

/** The editor set: what is open, what is active, what is unsaved. */
export type EditorsCapability = Capability<readonly EditorEntry[], EditorsActions>;

/** One diagnostic, flattened for a consumer that is not a VS Code editor. */
export interface DiagnosticEntry {
  /** The file the marker belongs to, as a URI string. */
  readonly resource: string;
  readonly severity: "error" | "warning" | "info" | "hint";
  readonly message: string;
  /** Who produced it (an extension id, a language server, …). */
  readonly source?: string;
  readonly code?: string;
  /** 1-based, the way the app reports positions. */
  readonly range: {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
  };
}

/** Counts, so a consumer can decide whether the detail is worth asking for. */
export interface DiagnosticsSummary {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly hint: number;
  /** How many files carry at least one diagnostic. */
  readonly resources: number;
}

/** A bounded slice of the diagnostics, with what it was taken from. */
export interface DiagnosticsPage {
  readonly entries: readonly DiagnosticEntry[];
  /** How many diagnostics matched the query (before paging). */
  readonly total: number;
  readonly offset: number;
  /** Whether the page is short because of a limit rather than because the data ended. */
  readonly truncated: boolean;
}

/** The default view of the diagnostics: a summary plus the most severe page. */
export interface DiagnosticsSnapshot {
  readonly summary: DiagnosticsSummary;
  readonly page: DiagnosticsPage;
}

/** A query for a consumer that wants a specific file or page. */
export interface DiagnosticsQuery {
  /** Restrict to one file (a URI string). Absent means the whole workspace. */
  readonly resource?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Diagnostics are read-only, and the capability says so instead of inventing
 * actions: what a consumer may *do* about a problem is not the marker service's
 * business.
 */
export type DiagnosticsActions = Record<string, never>;

/**
 * The problems the app knows about.
 *
 * This is the capability the whole layer exists for: an IDE knows what an agent
 * cannot see, and it knows it **late** — a language server answers after the file
 * opens, so a snapshot taken too early is not wrong, it is incomplete. Hence
 * `settled()`.
 */
export interface DiagnosticsCapability extends Capability<DiagnosticsSnapshot, DiagnosticsActions> {
  /**
   * A page of diagnostics, optionally for one file.
   *
   * Paging and a summary are part of the contract on purpose: the raw set can be
   * large, and a consumer (an agent, above all) should be able to ask "how bad is
   * it" before asking "show me everything".
   *
   * @param query - the filter and page.
   */
  query(query: DiagnosticsQuery): DiagnosticsPage;
}

/** What an embedder hands the workbench at boot. */
export interface EmbedBridge {
  /**
   * Whether the embedder's shell mounts the parts itself.
   *
   * `true` (an embedder that renders its own part hosts): the workbench mounts
   * nothing on its own and publishes {@link PartHostFace} through
   * {@link EmbedBridge.publish}. `false`/absent (a page that wants the workbench
   * composed by its own containers, e.g. `vendor/vscode/scripts/page.html`): the
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
