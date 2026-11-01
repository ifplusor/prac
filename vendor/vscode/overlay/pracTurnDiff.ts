/**
 * Turn-scoped in-memory diffs as ordinary prac editors.
 *
 * A stock `vscode.diff` input has no `resource` when its two sides differ, and
 * prac's placement projection only surfaces editors with a resource and a file
 * provider. This module closes that gap:
 *
 * - a read-only in-memory file system provider owns the two sides and the
 *   synthetic diff resource;
 * - `PracDiffEditorInput` extends `DiffEditorInput` and overrides `resource`
 *   with that synthetic URI, so the existing placement / tab / close / focus
 *   paths work unchanged;
 * - the host route `prac-turn-diff.text` supplies the strings; no temp files,
 *   no extension host hop.
 *
 * The synthetic path's last segment is the display title, which is what
 * `fileTitle(resource)` in `prac-client-vscode-host` shows in the tab.
 *
 * @module prac-turn-diff
 */

import { Event } from "../../base/common/event.js";
import { Disposable, DisposableStore, IDisposable, toDisposable } from "../../base/common/lifecycle.js";
import { URI } from "../../base/common/uri.js";
import { CommandsRegistry } from "../../platform/commands/common/commands.js";
import {
  FileSystemProviderCapabilities,
  FileType,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProvider,
  type IStat,
  type IWatchOptions,
} from "../../platform/files/common/files.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { DiffEditorInput } from "../common/editor/diffEditorInput.js";
import type { EditorInput } from "../common/editor/editorInput.js";
import { IEditorService } from "../services/editor/common/editorService.js";
import { ITextEditorService } from "../services/textfile/common/textEditorService.js";
import { IFileService } from "../../platform/files/common/files.js";

/** The URI scheme owned by this module; intentionally absent from `Schemas`. */
export const PRAC_TURN_DIFF_SCHEME = "prac-turn-diff";

/** The bridge command the prac card calls. */
export const PRAC_OPEN_TURN_DIFF = "prac.openTurnDiff";

/** Per-side character cap; mirrors the host route's 4 MB bound. */
const MAX_CHARS = 4 * 1024 * 1024;

/** Language id to a side's file extension, so the diff picks highlighting. */
const EXTENSION: Readonly<Record<string, string>> = {
  typescript: "ts",
  typescriptreact: "tsx",
  javascript: "js",
  javascriptreact: "jsx",
  json: "json",
  markdown: "md",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  yaml: "yml",
  python: "py",
  go: "go",
  rust: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  shellscript: "sh",
  diff: "diff",
  plaintext: "txt",
};

/** The in-memory, read-only file system behind the synthetic scheme. */
class PracTurnDiffFileSystem implements IFileSystemProvider {
  readonly capabilities = FileSystemProviderCapabilities.Readonly | FileSystemProviderCapabilities.FileReadWrite;
  readonly onDidChangeCapabilities = Event.None;
  readonly onDidChangeFile = Event.None;

  private readonly files = new Map<string, Uint8Array>();

  /** Add one side or the synthetic resource. */
  add(resource: URI, text: string): void {
    this.files.set(resource.toString(), new TextEncoder().encode(text));
  }

  /** Forget one resource after its tab closed. */
  remove(resource: URI): void {
    this.files.delete(resource.toString());
  }

  clear(): void {
    this.files.clear();
  }

  watch(_resource: URI, _options: IWatchOptions): IDisposable {
    return Disposable.None;
  }

  async stat(resource: URI): Promise<IStat> {
    const file = this.files.get(resource.toString());
    if (file === undefined) throw new Error(`prac-turn-diff: no such resource ${resource.toString()}`);
    return { type: FileType.File, size: file.byteLength, mtime: 0, ctime: 0 };
  }

  async readdir(_resource: URI): Promise<[string, FileType][]> {
    return [];
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const file = this.files.get(resource.toString());
    if (file === undefined) throw new Error(`prac-turn-diff: no such file ${resource.toString()}`);
    return file;
  }

  async writeFile(_resource: URI, _content: Uint8Array, _options: IFileOverwriteOptions): Promise<void> {
    throw new Error("prac-turn-diff: read-only");
  }

  async mkdir(_resource: URI): Promise<void> {
    throw new Error("prac-turn-diff: read-only");
  }

  async delete(_resource: URI, _options: IFileDeleteOptions): Promise<void> {
    throw new Error("prac-turn-diff: read-only");
  }

  async rename(_from: URI, _to: URI, _options: IFileOverwriteOptions): Promise<void> {
    throw new Error("prac-turn-diff: read-only");
  }
}

/** A diff input whose `resource` is the synthetic placement, not the side inputs. */
class PracDiffEditorInput extends DiffEditorInput {
  static override readonly ID = "workbench.editors.pracDiffEditorInput";

  constructor(
    preferredName: string | undefined,
    preferredDescription: string | undefined,
    original: EditorInput,
    modified: EditorInput,
    forceOpenAsBinary: boolean | undefined,
    private readonly synthetic: URI,
    @IEditorService editorService: IEditorService,
  ) {
    super(preferredName, preferredDescription, original, modified, forceOpenAsBinary, editorService);
  }

  override get resource(): URI {
    return this.synthetic;
  }
}

/** The payload the prac card sends through the command bridge. */
export interface PracTurnDiffArgs {
  before: string;
  after: string;
  title: string;
  language: string;
}

let sequence = 0;

/**
 * Register the read-only provider and the diff command. The returned disposable
 * removes both and clears the in-memory sides.
 */
export function registerPracTurnDiff(instantiationService: IInstantiationService): IDisposable {
  const store = new DisposableStore();
  const files = new PracTurnDiffFileSystem();
  const fileService = instantiationService.invokeFunction((accessor) => accessor.get(IFileService));
  store.add(fileService.registerProvider(PRAC_TURN_DIFF_SCHEME, files));

  const editorService = instantiationService.invokeFunction((accessor) => accessor.get(IEditorService));
  store.add(editorService.onDidCloseEditor((event) => {
    if (!(event.editor instanceof PracDiffEditorInput)) return;
    files.remove(event.editor.resource);
    if (event.editor.original.resource !== undefined) files.remove(event.editor.original.resource);
    if (event.editor.modified.resource !== undefined) files.remove(event.editor.modified.resource);
  }));

  store.add(CommandsRegistry.registerCommand(PRAC_OPEN_TURN_DIFF, async (accessor, raw) => {
    const args = raw as Partial<PracTurnDiffArgs> | undefined;
    const before = String(args?.before ?? "");
    const after = String(args?.after ?? "");
    if (before.length > MAX_CHARS || after.length > MAX_CHARS) {
      throw new Error("prac.openTurnDiff: each side is too large");
    }
    const title = String(args?.title ?? "Turn diff");
    const language = String(args?.language ?? "plaintext");
    const ext = EXTENSION[language] ?? "txt";
    const id = `${Date.now().toString(36)}-${sequence++}`;
    const side = (name: string): URI => URI.from({
      scheme: PRAC_TURN_DIFF_SCHEME,
      authority: "turn",
      path: `/${id}/${name}`,
    });
    const originalUri = side(`before.${ext}`);
    const modifiedUri = side(`after.${ext}`);
    const synthetic = URI.from({
      scheme: PRAC_TURN_DIFF_SCHEME,
      authority: "turn",
      path: `/${id}/${title}`,
    });
    files.add(originalUri, before);
    files.add(modifiedUri, after);
    files.add(synthetic, "");
    const textEditorService = accessor.get(ITextEditorService);
    const original = textEditorService.createTextEditor({ resource: originalUri, language });
    const modified = textEditorService.createTextEditor({ resource: modifiedUri, language });
    const input = accessor.get(IInstantiationService).createInstance(
      PracDiffEditorInput,
      title,
      undefined,
      original,
      modified,
      false,
      synthetic,
    );
    await accessor.get(IEditorService).openEditor(input, { pinned: true });
  }));

  store.add(toDisposable(() => files.clear()));
  return store;
}
