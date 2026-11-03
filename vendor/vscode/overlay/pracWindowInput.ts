/**
 * The identity projection of a non-editor window (chat, board, …).
 *
 * The content is rendered by prac's frame; this input exists so VS Code's
 * editor services can see the window's identity, order and active state. Its
 * pane is intentionally empty — mounting content here would be a second
 * renderer.
 *
 * @module prac/vscode/overlay/pracWindowInput
 */
import { URI } from "../../base/common/uri.js";
import { EditorInputCapabilities } from "../common/editor.js";
import { EditorInput } from "../common/editor/editorInput.js";

/** A window that frame renders; the adapter only maps it. */
export class PracWindowInput extends EditorInput {
  static readonly typeId = "workbench.editors.pracWindowInput";

  /** The frame window id (a content-slot view id). */
  readonly windowId: string;
  private title: string;

  constructor(windowId = "", title = "") {
    super();
    this.windowId = windowId;
    this.title = title;
  }

  override get typeId(): string {
    return PracWindowInput.typeId;
  }

  override get resource(): URI {
    return URI.from({ scheme: "prac-window", path: `/${this.windowId}` });
  }

  override get capabilities(): EditorInputCapabilities {
    return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
  }

  /** Update the title without creating a second input. */
  setTitle(title: string): void {
    if (title === this.title) return;
    this.title = title;
    this._onDidChangeLabel.fire();
  }

  override getName(): string {
    return this.title;
  }

  override getDescription(): string {
    return "";
  }
}
