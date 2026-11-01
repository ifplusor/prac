/**
 * The non-rendering pane for a frame-owned window.
 *
 * It gives VS Code an `EditorPane` to lay out / show / focus, but it paints
 * nothing: the content lives in prac's frame. This is the `WebviewEditor` host
 * shape without a webview — an element plus lifecycle, with the renderer
 * elsewhere.
 *
 * @module prac/vscode/overlay/pracWindowPane
 */
import type { Dimension } from "../../base/browser/dom.js";
import { IThemeService } from "../../platform/theme/common/themeService.js";
import { ITelemetryService } from "../../platform/telemetry/common/telemetry.js";
import { IStorageService } from "../../platform/storage/common/storage.js";
import { EditorPane } from "./parts/editor/editorPane.js";
import type { IEditorGroup } from "../services/editor/common/editorGroupsService.js";

/** One frame-owned window's empty pane host. */
export class PracWindowPane extends EditorPane {
  static readonly ID = "workbench.editors.pracWindowPane";

  private element: HTMLElement | undefined;

  constructor(
    group: IEditorGroup,
    @ITelemetryService telemetryService: ITelemetryService,
    @IThemeService themeService: IThemeService,
    @IStorageService storageService: IStorageService,
  ) {
    super(PracWindowPane.ID, group, telemetryService, themeService, storageService);
  }

  protected createEditor(parent: HTMLElement): void {
    const element = document.createElement("div");
    element.className = "prac-window-pane";
    element.style.cssText = "display:flex;flex:1 1 auto;min-width:0;min-height:0;";
    this.element = element;
    parent.append(element);
  }

  override layout(_dimension: Dimension): void {
    // The frame owns the content and its box; an empty host has nothing to lay out.
  }

  override focus(): void {
    // Frame content owns focus; this pane must not steal it.
  }

  override dispose(): void {
    this.element?.remove();
    this.element = undefined;
    super.dispose();
  }
}
