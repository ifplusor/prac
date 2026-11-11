/**
 * The one place frame-owned windows become editor inputs.
 *
 * This is the write boundary S3 converges on: the frame remains the source of
 * window identity / active / order / region, and this projection applies that
 * state to VS Code's editor model. It owns no content — `PracWindowPane` is
 * empty — and it does not render.
 *
 * @module prac/vscode/overlay/pracWindowProjection
 */
import type { IEditorService } from "../services/editor/common/editorService.js";
import type {
  IEditorGroup,
  IEditorGroupsService,
} from "../services/editor/common/editorGroupsService.js";
import type { IEditorIdentifier } from "../common/editor.js";
import type { PracWindowGroupHost } from "./pracWindowGroupHost.js";
import { PracWindowInput } from "./pracWindowInput.js";

/** Depth of synchronous frame→model writes; 0 means an editor-service write. */
let projectionWriteDepth = 0;

/** Whether the current model write originated in the frame projection. */
export function isProjectionWrite(): boolean {
  return projectionWriteDepth > 0;
}

function withProjectionWrite<T>(write: () => T): T {
  projectionWriteDepth += 1;
  try {
    return write();
  } finally {
    projectionWriteDepth -= 1;
  }
}

/** Counters for every model write this projection made (diagnostics). */
export interface PracWindowProjectionAudit {
  readonly map: number;
  readonly activate: number;
  readonly order: number;
  readonly unmap: number;
}

/** The frame → editor-input projection for non-file windows. */
export class PracWindowProjection {
  private readonly inputs = new Map<string, PracWindowInput>();
  private readonly writes = { map: 0, activate: 0, order: 0, unmap: 0 };

  constructor(
    private readonly editorService: IEditorService,
    private readonly groups: IEditorGroupsService,
  ) {}

  /**
   * The windows the frame has projected.
   *
   * This mirrors the WM, not the editor groups: the WM owns which windows exist,
   * and a window need not have an editor group (a board has its own layout).
   * Asking the editor groups would let such a window vanish from the projection.
   */
  mapped(): readonly string[] {
    return [...this.inputs.keys()];
  }

  /** The currently active projected window, if any. */
  active(): string | null {
    const active = this.editorService.activeEditor;
    return active instanceof PracWindowInput ? active.windowId : null;
  }

  /** The audit counters. */
  audit(): PracWindowProjectionAudit {
    return this.writes;
  }

  /** Map (or move) one window into its frame region's group, inactive. */
  map(id: string, title: string, region?: string): void {
    let input = this.inputs.get(id);
    if (input === undefined) {
      input = new PracWindowInput(id, title);
      this.inputs.set(id, input);
    } else {
      input.setTitle(title);
    }
    // The WM owns which windows exist; the projection only mirrors them. A
    // region without an editor group (a board's own layout) still gets a pane
    // host, so the window is not dropped just because no file landed there.
    const group = this.groupForRegion(region) ?? this.ensureGroup(region);
    if (group === undefined) return;
    this.writes.map += 1;
    withProjectionWrite(() => {
      void this.editorService.openEditor(input, { inactive: true, preserveFocus: true }, group);
    });
  }

  /** Make one projected window the active editor, without focusing its empty pane. */
  activate(id: string): void {
    const input = this.inputs.get(id);
    if (input === undefined || this.editorService.activeEditor === input) return;
    const group = this.groups.groups.find((candidate) => candidate.editors.includes(input));
    this.writes.activate += 1;
    withProjectionWrite(() => {
      void this.editorService.openEditor(input, { preserveFocus: true }, group);
    });
  }

  /** Apply a frame order index inside the group that actually owns the input. */
  order(id: string, index: number): void {
    const input = this.inputs.get(id);
    if (input === undefined) return;
    const group = this.groups.groups.find((candidate) => candidate.editors.includes(input));
    if (group === undefined) return;
    this.writes.order += 1;
    withProjectionWrite(() => group.moveEditor(input, group, { index }));
  }

  /** Apply a frame order index to a file input (the frame's file views). */
  orderFile(resource: string, index: number): void {
    for (const group of this.groups.groups) {
      const editor = group.editors.find((candidate) => candidate.resource?.toString() === resource);
      if (editor === undefined) continue;
      this.writes.order += 1;
      withProjectionWrite(() => group.moveEditor(editor, group, { index }));
      return;
    }
  }

  /** The group's order with frame window ids in place. */
  windowOrder(region?: string): readonly string[] {
    const group = this.groupForRegion(region) ?? this.groups.activeGroup;
    if (group === null) return [];
    return group.editors.map((editor) =>
      editor instanceof PracWindowInput ? editor.windowId : (editor.resource?.toString() ?? ""),
    );
  }

  /** Remove a projection when the frame no longer has the window. */
  unmap(id: string): void {
    const input = this.inputs.get(id);
    if (input === undefined) return;
    this.inputs.delete(id);
    this.writes.unmap += 1;
    // The editor service closes by input at runtime (the pre-projection code did
    // this); its public overload is typed as an identifier. Keep this one narrow
    // cast here rather than widening the projection's API.
    withProjectionWrite(() => {
      void this.editorService.closeEditor(input as unknown as IEditorIdentifier);
    });
  }

  private groupForRegion(region?: string): IEditorGroup | undefined {
    if (region === undefined) return this.groups.activeGroup ?? undefined;
    const host = this.groups as unknown as PracWindowGroupHost;
    return host.groupForRegion?.(region) ?? undefined;
  }

  private ensureGroup(region: string): IEditorGroup | undefined {
    const host = this.groups as unknown as PracWindowGroupHost;
    return host.ensureGroup?.(region, region) as IEditorGroup | undefined;
  }
}
