/**
 * prac's own **editor group** — the equivalent of the workbench's `EditorGroupView`.
 *
 * The workbench's editor container cannot be borrowed as-is: the **part** cannot be
 * combined with DSH's views (which is why file surfaces stopped being parts in the
 * first place), and a **group view** is a closed world for editors — while a prac
 * region has to be able to hold prac views and editor surfaces alike. So the group
 * is prac's object, and its element is mounted into a prac region: that is what lets
 * one region hold a file surface next to any other view.
 *
 * What *is* borrowed, deliberately, is everything that is behaviour rather than
 * container:
 *
 * - `EditorGroupModel` — which editors are open, their order, the active one, and
 *   preview / pinned / sticky / transient semantics. Most members below delegate.
 * - `EditorPanes` — creating panes, their lifecycle, moving their DOM.
 * - The pane classes themselves (registered through `IEditorPaneRegistry`), so the
 *   editing experience is the workbench's own rather than a look-alike.
 *
 * One requirement comes with `EditorPanes` and is easy to miss: a group needs **its
 * own instance scope** — a progress bar plus a scoped `IContextKeyService`, with
 * `IEditorProgressService` provided *per group* by an `EditorProgressIndicator`. It
 * is not a global service; the composition has to build this scope (measured:
 * without it construction fails with `UNKNOWN service editorProgressService`).
 *
 * Vision: **prac's region tree is the editor grid.** One region that holds files is
 * one group; splitting a region is how a second group is born.
 *
 * This file lives in the upstream-tree payload (see `.eslintignore`): it imports
 * `vs/...` internals by relative path and is compiled inside the checkout, by
 * upstream's build, not by the repo's own checker.
 *
 * @module prac/vscode/overlay/pracEditorGroup
 */
import { Emitter, Event } from "../../base/common/event.js";
import { Disposable, DisposableStore } from "../../base/common/lifecycle.js";
import { Dimension } from "../../base/browser/dom.js";
import { mainWindow } from "../../base/browser/window.js";
import { ProgressBar } from "../../base/browser/ui/progressbar/progressbar.js";
import { MenuId } from "../../platform/actions/common/actions.js";
import { IContextKeyService } from "../../platform/contextkey/common/contextkey.js";
import { IEditorOptions } from "../../platform/editor/common/editor.js";
import { IEditorProgressService } from "../../platform/progress/common/progress.js";
import { defaultProgressBarStyles } from "../../platform/theme/browser/defaultStyles.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { ServiceCollection } from "../../platform/instantiation/common/serviceCollection.js";
import { ILogService } from "../../platform/log/common/log.js";
import { EditorProgressIndicator } from "../services/progress/browser/progressIndicator.js";
import {
  IEditorGroupView,
  IEditorGroupViewOptions,
  IEditorGroupsView,
  IEditorGroupTitleHeight,
  IInternalEditorOpenOptions,
} from "./parts/editor/editor.js";
import {
  IActiveEditorActions,
  ICloseAllEditorsOptions,
  ICloseEditorOptions,
  ICloseEditorsFilter,
  IEditorGroup,
  IEditorReplacement,
} from "../services/editor/common/editorGroupsService.js";
import {
  EditorsOrder,
  GroupIdentifier,
  GroupModelChangeKind,
  IActiveEditorChangeEvent,
  IEditorCloseEvent,
  IEditorOpenContext,
  IEditorWillMoveEvent,
  IEditorWillOpenEvent,
  IFindEditorOptions,
  IMatchEditorOptions,
  IUntypedEditorInput,
  IVisibleEditorPane,
} from "../common/editor.js";
import { EditorGroupModel, IGroupModelChangeEvent } from "../common/editor/editorGroupModel.js";
import { EditorInput } from "../common/editor/editorInput.js";
import { EditorPanes } from "./parts/editor/editorPanes.js";
import { URI } from "../../base/common/uri.js";

/**
 * Everything this group does **not** do yet.
 *
 * Listed rather than silently dropped: each entry is a group-level action from the
 * workbench's editor *grid*, and prac's grid is its region tree — mapping them is a
 * separate decision (James 2026-10-07), so the group refuses and logs instead of
 * pretending.
 */
export const UNSUPPORTED_GROUP_OPERATIONS = [
  "moveEditor/moveEditors — mapping a file between prac regions",
  "copyEditor/copyEditors",
  "replaceEditors",
] as const;

/**
 * prac's editor group: an `IEditorGroupView` whose DOM belongs to a prac region.
 */
export class PracEditorGroup extends Disposable implements IEditorGroupView {
  /** The group's element; the embedder mounts it into a prac region. */
  readonly element: HTMLElement;

  /** The element prac mounted this group into, once it has (see `create`). */
  host: HTMLElement | undefined;

  /** Where `EditorPanes` puts each pane's container (`.editor-instance`). */
  private readonly editorContainer: HTMLElement;

  private readonly model: EditorGroupModel;
  private readonly editorPanes: EditorPanes;
  private readonly progressBar: ProgressBar;

  /** The scope the group's panes live in; the interface exposes it. */
  readonly scopedContextKeyService: IContextKeyService;

  /** The host this group belongs to (prac's region-level editor host). */
  readonly groupsView: IEditorGroupsView;

  private activePane: IVisibleEditorPane | undefined;
  private _isActive = false;
  private _isVisible = true;
  private _disposed = false;
  private _dimension: Dimension = new Dimension(0, 0);
  private _label: string;
  private _index: number;

  private readonly _onDidFocus = this._register(new Emitter<void>());
  private readonly _onWillOpenEditor = this._register(new Emitter<IEditorWillOpenEvent>());
  private readonly _onDidOpenEditorFail = this._register(new Emitter<EditorInput>());
  private readonly _onWillCloseEditor = this._register(new Emitter<IEditorCloseEvent>());
  private readonly _onDidCloseEditor = this._register(new Emitter<IEditorCloseEvent>());
  private readonly _onWillMoveEditor = this._register(new Emitter<IEditorWillMoveEvent>());
  private readonly _onWillDispose = this._register(new Emitter<void>());
  private readonly _onDidActiveEditorChange = this._register(
    new Emitter<IActiveEditorChangeEvent>(),
  );
  private readonly _onDidChange = this._register(
    new Emitter<{ width: number; height: number } | undefined>(),
  );

  readonly onDidFocus = this._onDidFocus.event;
  readonly onWillOpenEditor = this._onWillOpenEditor.event;
  readonly onDidOpenEditorFail = this._onDidOpenEditorFail.event;
  readonly onWillCloseEditor = this._onWillCloseEditor.event;
  readonly onDidCloseEditor = this._onDidCloseEditor.event;
  readonly onWillMoveEditor = this._onWillMoveEditor.event;
  readonly onWillDispose = this._onWillDispose.event;
  readonly onDidActiveEditorChange = this._onDidActiveEditorChange.event;
  readonly onDidChange = this._onDidChange.event;
  /** The model's own change event, re-exposed as the group's. */
  readonly onDidModelChange: Event<IGroupModelChangeEvent>;

  constructor(
    groupsView: IEditorGroupsView,
    private readonly instantiationService: IInstantiationService,
    private readonly logService: ILogService,
    label: string,
    index: number,
    _options?: IEditorGroupViewOptions,
  ) {
    super();
    this.groupsView = groupsView;
    this._label = label;
    this._index = index;

    this.element = document.createElement("div");
    this.element.classList.add("editor-group-container", "prac-editor-group");
    this.editorContainer = document.createElement("div");
    this.editorContainer.classList.add("editor-container");
    this.element.append(this.editorContainer);

    // The model first: everything below (the group's events, the progress
    // indicator's listeners, the panes) reads the model while it is being built, so
    // it has to exist — and its event has to be exposed — before they are.
    this.model = this._register(
      this.instantiationService.createInstance(EditorGroupModel, undefined),
    );
    this.onDidModelChange = this.model.onDidModelChange;
    this._register(this.model.onDidModelChange((event) => this.onModelChanged(event)));

    // Then the group's own scope, exactly as the workbench's group builds it.
    this.progressBar = this._register(new ProgressBar(this.element, defaultProgressBarStyles));
    this.progressBar.hide();
    this.scopedContextKeyService = this._register(
      this.instantiationService
        .invokeFunction((accessor) => accessor.get(IContextKeyService))
        .createScoped(this.element),
    );
    const scoped = this._register(
      this.instantiationService.createChild(
        new ServiceCollection(
          [IContextKeyService, this.scopedContextKeyService],
          [
            IEditorProgressService,
            this._register(new EditorProgressIndicator(this.progressBar, this)),
          ],
        ),
      ),
    );

    this.editorPanes = this._register(
      scoped.createInstance(EditorPanes, this.element, this.editorContainer, this),
    );
  }

  //#region The model's bookkeeping, delegated

  get id(): GroupIdentifier {
    return this.model.id;
  }

  get windowId(): number {
    return mainWindow.vscodeWindowId;
  }

  get index(): number {
    return this._index;
  }

  get label(): string {
    return this._label;
  }

  get ariaLabel(): string {
    return this._label;
  }

  get count(): number {
    return this.model.count;
  }

  get isEmpty(): boolean {
    return this.model.count === 0;
  }

  get isLocked(): boolean {
    return this.model.isLocked;
  }

  get stickyCount(): number {
    return this.model.stickyCount;
  }

  get editors(): readonly EditorInput[] {
    return this.model.getEditors(EditorsOrder.SEQUENTIAL);
  }

  get selectedEditors(): EditorInput[] {
    return this.model.selectedEditors;
  }

  get previewEditor(): EditorInput | null {
    return this.model.previewEditor;
  }

  get activeEditor(): EditorInput | null {
    return this.model.activeEditor;
  }

  get activeEditorPane(): IVisibleEditorPane | undefined {
    return this.activePane;
  }

  get whenRestored(): Promise<void> {
    return Promise.resolve();
  }

  /** prac draws the region's chrome (its tab strip), so the group has no title. */
  get titleHeight(): IEditorGroupTitleHeight {
    return { total: 0, offset: 0 };
  }

  get disposed(): boolean {
    return this._disposed;
  }

  getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): readonly EditorInput[] {
    return this.model.getEditors(order, options);
  }

  findEditors(resource: URI, options?: IFindEditorOptions): readonly EditorInput[] {
    return this.model
      .getEditors(EditorsOrder.SEQUENTIAL)
      .filter((editor) => editor.resource?.toString() === resource.toString())
      .filter((editor) => editor.resource !== undefined || options !== undefined);
  }

  getEditorByIndex(index: number): EditorInput | undefined {
    return this.model.getEditorByIndex(index);
  }

  getIndexOfEditor(editor: EditorInput): number {
    return this.model.indexOf(editor);
  }

  isFirst(editor: EditorInput): boolean {
    return this.model.isFirst(editor);
  }

  isLast(editor: EditorInput): boolean {
    return this.model.isLast(editor);
  }

  isPinned(editorOrIndex: EditorInput | number): boolean {
    return this.model.isPinned(editorOrIndex);
  }

  isSticky(editorOrIndex: EditorInput | number): boolean {
    return this.model.isSticky(editorOrIndex);
  }

  isTransient(editorOrIndex: EditorInput | number): boolean {
    return this.model.isTransient(editorOrIndex);
  }

  isActive(editor: EditorInput | IUntypedEditorInput): boolean {
    return this.model.isActive(editor);
  }

  isSelected(editor: EditorInput): boolean {
    return this.model.isSelected(editor);
  }

  contains(candidate: EditorInput | IUntypedEditorInput, options?: IMatchEditorOptions): boolean {
    return this.model.contains(candidate, options);
  }

  async setSelection(
    activeSelectedEditor: EditorInput,
    inactiveSelectedEditors: EditorInput[],
  ): Promise<void> {
    this.model.setSelection(activeSelectedEditor, inactiveSelectedEditors);
  }

  //#endregion

  //#region Opening and closing

  /**
   * Open an editor in this group.
   *
   * The order the workbench's group guarantees: the model learns about the editor
   * first (order, pinned, preview are the model's call), then `EditorPanes` creates
   * the pane, and only then is it made active and the events fired.
   *
   * @param editor - the editor input, already resolved by the editor service.
   * @param options - open options (`pinned`, `preserveFocus`, …).
   * @param internalOptions - internal open options.
   * @returns the pane, or `undefined` when opening failed.
   */
  async openEditor(
    editor: EditorInput,
    options?: IEditorOptions,
    internalOptions?: IInternalEditorOpenOptions,
  ): Promise<IVisibleEditorPane | undefined> {
    this._onWillOpenEditor.fire({ editor, groupId: this.id });
    try {
      this.model.openEditor(editor, {
        pinned: options?.pinned,
        sticky: options?.sticky,
        transient: options?.transient,
        // Active unless the caller asked otherwise — the same intent the workbench's
        // group has. Without this the model only reports "editor opened", never
        // "active editor changed", and everything that follows the active editor (the
        // editor service's own events, the Outline, the Timeline) stays silent.
        active: options?.inactive !== true,
      });
      const result = await this.editorPanes.openEditor(
        editor,
        options,
        internalOptions,
        Object.create(null) as IEditorOpenContext,
      );
      if (result.error !== undefined) {
        this._onDidOpenEditorFail.fire(editor);
        return undefined;
      }
      const pane = (result.pane ?? undefined) as IVisibleEditorPane | undefined;
      this.activePane = pane;
      if (options?.preserveFocus !== true) pane?.focus();
      return pane;
    } catch (error) {
      this.logService.error("vscode-embed: failed to open an editor in a prac group", error);
      this._onDidOpenEditorFail.fire(editor);
      return undefined;
    }
  }

  /**
   * Open several editors, in order.
   *
   * @param editors - the editors with their options.
   * @returns the last pane opened.
   */
  async openEditors(
    editors: { editor: EditorInput; options?: IEditorOptions }[],
  ): Promise<IVisibleEditorPane | undefined> {
    let pane: IVisibleEditorPane | undefined;
    for (const { editor, options } of editors) {
      pane = await this.openEditor(editor, options);
    }
    return pane;
  }

  /**
   * Close one editor.
   *
   * @param editor - the editor to close; the active one when omitted.
   * @param options - close options (only `force` is meaningful here).
   * @returns whether an editor was closed.
   */
  async closeEditor(editor?: EditorInput, options?: ICloseEditorOptions): Promise<boolean> {
    const candidate = editor ?? this.activeEditor;
    if (!candidate) return false;
    const event = { editor: candidate, groupId: this.id } as unknown as IEditorCloseEvent;
    this._onWillCloseEditor.fire(event);
    this.editorPanes.closeEditor(candidate);
    const result = this.model.closeEditor(candidate);
    if (result === undefined && options?.force !== true) return false;
    this._onDidCloseEditor.fire(event);
    return true;
  }

  /**
   * Close several editors.
   *
   * @param editors - the editors to close, or a filter (the filter's own semantics
   * are not implemented; see {@link UNSUPPORTED_GROUP_OPERATIONS}).
   * @param options - close options.
   * @returns whether every editor was closed.
   */
  async closeEditors(
    editors: EditorInput[] | ICloseEditorsFilter,
    options?: ICloseEditorOptions,
  ): Promise<boolean> {
    const list = Array.isArray(editors) ? editors : this.model.getEditors(EditorsOrder.SEQUENTIAL);
    let closed = true;
    for (const editor of list) {
      closed = (await this.closeEditor(editor, options)) && closed;
    }
    return closed;
  }

  /**
   * Close every editor in this group.
   *
   * @param options - close options.
   * @returns whether every editor was closed.
   */
  closeAllEditors(options: { excludeConfirming: true; force?: boolean }): boolean;
  closeAllEditors(options?: ICloseAllEditorsOptions): Promise<boolean>;
  closeAllEditors(
    options?: ICloseAllEditorsOptions | { excludeConfirming: true; force?: boolean },
  ): boolean | Promise<boolean> {
    const list = this.model.getEditors(EditorsOrder.SEQUENTIAL);
    const closing = this.closeEditors(list, options as ICloseEditorOptions);
    return (options as { excludeConfirming?: boolean } | undefined)?.excludeConfirming === true
      ? (void closing, true)
      : closing;
  }

  //#endregion

  //#region Group-level grid operations: refused, with a log line

  moveEditor(_editor: EditorInput, _target: IEditorGroup, _options?: IEditorOptions): boolean {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[0]}`,
    );
    return false;
  }

  moveEditors(
    _editors: { editor: EditorInput; options?: IEditorOptions }[],
    _target: IEditorGroup,
  ): boolean {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[0]}`,
    );
    return false;
  }

  copyEditor(_editor: EditorInput, _target: IEditorGroup, _options?: IEditorOptions): void {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[1]}`,
    );
  }

  copyEditors(
    _editors: { editor: EditorInput; options?: IEditorOptions }[],
    _target: IEditorGroup,
  ): void {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[1]}`,
    );
  }

  async replaceEditors(_editors: IEditorReplacement[]): Promise<void> {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[2]}`,
    );
  }

  //#endregion

  /**
   * Pin, stick and lock are the model's own semantics, so they go straight there.
   *
   * @param editor - the editor to pin; the active one when omitted.
   */
  pinEditor(editor?: EditorInput): void {
    const candidate = editor ?? this.activeEditor;
    if (candidate) this.model.pin(candidate);
  }

  /**
   * @param editor - the editor to stick; the active one when omitted.
   */
  stickEditor(editor?: EditorInput): void {
    const candidate = editor ?? this.activeEditor;
    if (candidate) this.model.stick(candidate);
  }

  /**
   * @param editor - the editor to unstick; the active one when omitted.
   */
  unstickEditor(editor?: EditorInput): void {
    const candidate = editor ?? this.activeEditor;
    if (candidate) this.model.unstick(candidate);
  }

  /**
   * @param locked - whether the group refuses new editors.
   */
  lock(locked: boolean): void {
    this.model.lock(locked);
  }

  /**
   * Editor title actions are prac's chrome (the region's tab strip), so this group
   * has none to offer — the list of unsupported operations is the honest answer.
   *
   * @param _disposables - ignored; nothing is contributed.
   * @param _menuId - ignored.
   * @returns an empty action set that never changes.
   */
  createEditorActions(_disposables: DisposableStore, _menuId?: MenuId): IActiveEditorActions {
    this.logService.info(
      "vscode-embed: unsupported group operation — editor title actions (prac draws the tabs)",
    );
    return { actions: { primary: [], secondary: [] }, onDidChange: Event.None };
  }

  //#endregion

  //#region The view contract (prac's region tree is the grid)

  get minimumWidth(): number {
    return 0;
  }

  get minimumHeight(): number {
    return 0;
  }

  get maximumWidth(): number {
    return Number.POSITIVE_INFINITY;
  }

  get maximumHeight(): number {
    return Number.POSITIVE_INFINITY;
  }

  /**
   * Lay the group out in the box prac gave it.
   *
   * @param width - the box's width.
   * @param height - the box's height.
   * @param top - the box's top offset.
   * @param left - the box's left offset.
   */
  layout(width: number, height: number, top: number, left: number): void {
    this._dimension = new Dimension(width, height);
    // prac owns the region chrome, so the content starts at the top of the box.
    this.editorPanes.layout({ width, height, top, left });
    this._onDidChange.fire({ width, height });
  }

  /** Re-run the last layout (the embedder calls this when its host resizes). */
  relayout(): void {
    this.layout(this._dimension.width, this._dimension.height, 0, 0);
  }

  /**
   * The embedder owns visibility — it is what shows and hides regions — so this
   * records the state and forwards it to the panes instead of hiding anything.
   *
   * @param visible - whether prac is showing this group's region.
   */
  setVisible(visible: boolean): void {
    this._isVisible = visible;
    this.editorPanes.setVisible(visible);
  }

  isVisible(): boolean {
    return this._isVisible;
  }

  /**
   * Attach the group to the element prac prepared for it.
   *
   * @param parent - the host element.
   */
  create(parent: HTMLElement): void {
    this.host = parent;
    parent.append(this.element);
    this.relayout();
  }

  focus(): void {
    this._onDidFocus.fire();
    this.activePane?.focus();
  }

  setActive(isActive: boolean): void {
    this._isActive = isActive;
  }

  /**
   * Whether prac considers this the group of the focused region.
   *
   * @returns the state the host last set through {@link setActive}.
   */
  isActiveGroup(): boolean {
    return this._isActive;
  }

  notifyIndexChanged(newIndex: number): void {
    this._index = newIndex;
  }

  notifyLabelChanged(newLabel: string): void {
    this._label = newLabel;
  }

  toJSON(): object {
    return { id: this.id, editors: this.editors.map((editor) => editor.getName()) };
  }

  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._onWillDispose.fire();
    super.dispose();
  }

  //#endregion

  private onModelChanged(event: IGroupModelChangeEvent): void {
    if (event.kind === GroupModelChangeKind.EDITOR_ACTIVE) {
      this.activePane = (this.editorPanes.activeEditorPane ?? undefined) as
        | IVisibleEditorPane
        | undefined;
      this._onDidActiveEditorChange.fire({ editor: this.model.activeEditor ?? undefined });
    }
  }
}
