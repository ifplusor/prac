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
import { IMenuChangeEvent, IMenuService, MenuId } from "../../platform/actions/common/actions.js";
import {
  getActionBarActions,
  PrimaryAndSecondaryActions,
} from "../../platform/actions/browser/menuEntryActionViewItem.js";
import { ToolBar } from "../../base/browser/ui/toolbar/toolbar.js";
import { IContextMenuService } from "../../platform/contextview/browser/contextView.js";
import { Separator, SubmenuAction } from "../../base/common/actions.js";
import { ICommandService } from "../../platform/commands/common/commands.js";
import { IContextKeyService } from "../../platform/contextkey/common/contextkey.js";
import { EditorActivation, IEditorOptions } from "../../platform/editor/common/editor.js";
import {
  ConfirmResult,
  IDialogService,
  IFileDialogService,
} from "../../platform/dialogs/common/dialogs.js";
import { IEditorProgressService } from "../../platform/progress/common/progress.js";
import { IEditorService } from "../services/editor/common/editorService.js";
import { IEditorResolverService } from "../services/editor/common/editorResolverService.js";
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
  EditorInputCapabilities,
  EditorsOrder,
  GroupModelChangeKind,
  GroupIdentifier,
  IActiveEditorChangeEvent,
  IEditorCloseEvent,
  IEditorOpenContext,
  IEditorWillMoveEvent,
  IEditorWillOpenEvent,
  IFindEditorOptions,
  IMatchEditorOptions,
  SaveReason,
  IUntypedEditorInput,
  IVisibleEditorPane,
} from "../common/editor.js";
import {
  EditorGroupModel,
  IEditorOpenOptions,
  IGroupModelChangeEvent,
} from "../common/editor/editorGroupModel.js";
import { EditorInput } from "../common/editor/editorInput.js";
import { EditorHeaderControl } from "./parts/editor/editorHeaderControl.js";
import { EditorPane } from "./parts/editor/editorPane.js";
import { EditorPanes } from "./parts/editor/editorPanes.js";
import {
  createEditorTypeActions,
  getAvailableEditorTypes,
} from "./parts/editor/editorTypePicker.js";
import {
  AutoSaveMode,
  IFilesConfigurationService,
} from "../services/filesConfiguration/common/filesConfigurationService.js";
import { URI } from "../../base/common/uri.js";

/**
 * Everything this group does **not** do yet.
 *
 * Listed rather than silently dropped: each entry is a group-level action from the
 * workbench's editor *grid*, and prac's grid is its region tree — mapping them is a
 * separate decision (James 2026-10-07), so the group refuses and logs instead of
 * pretending.
 */
export const UNSUPPORTED_GROUP_OPERATIONS = ["replaceEditors"] as const;

/**
 * prac's editor group: an `IEditorGroupView` whose DOM belongs to a prac region.
 */
export class PracEditorGroup extends Disposable implements IEditorGroupView {
  /** The group's element; the embedder mounts it into a prac region. */
  readonly element: HTMLElement;
  /** The title area above the editor: breadcrumbs, and the place actions would go. */
  private readonly titleElement: HTMLElement;
  /**
   * The workbench's own header control: breadcrumbs (and, upstream, title actions).
   *
   * Created on the **first layout**, not in the constructor: the breadcrumbs pull in
   * services that need `IEditorService`, and this group is built *while* that service is
   * being constructed — creating it eagerly threw `illegal state - RECURSIVELY
   * instantiating service 'editorService'` and took the whole boot down.
   */
  private header: EditorHeaderControl | undefined;
  /** The editor actions toolbar in the title row (the workbench's own actions). */
  private actionsBar: ToolBar | undefined;
  /** The element the actions toolbar renders into. */
  private actionsElement: HTMLElement | undefined;
  /** What the actions toolbar's menu subscriptions are bound to. */
  private readonly actionsDisposables = this._register(new DisposableStore());

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
    // The title area (the part above the editor): breadcrumbs live here, and this is
    // what upstream's `EditorTitleControl` composes. prac draws its own **tabs** in the
    // region's strip, so the workbench's tab control is deliberately not created — but
    // the rest of the title area is, because without it the editor has no breadcrumbs
    // (measured: no `.monaco-breadcrumbs` in the group at all, and `titleHeight` 0).
    this.titleElement = document.createElement("div");
    this.titleElement.classList.add("prac-editor-title");
    this.editorContainer = document.createElement("div");
    this.editorContainer.classList.add("editor-container");
    this.element.append(this.titleElement, this.editorContainer);

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

  /**
   * The editors the person has selected.
   *
   * prac's chrome has no multi-select — a region shows one editor, and the frame's tab
   * strip has no shift-click — so the model's selection stays empty unless something sets
   * it, while the workbench's own commands read this member to decide *what* to copy,
   * move or close. Here the selection **is** the active editor. Measured without the
   * fallback: `workbench.action.splitEditorToNextGroup` found nothing to copy and did
   * nothing at all, so VS Code's split editor was dead in prac.
   */
  get selectedEditors(): EditorInput[] {
    const selected = this.model.selectedEditors;
    if (selected.length > 0) return selected;
    const active = this.model.activeEditor;
    return active === null ? [] : [active];
  }

  get previewEditor(): EditorInput | null {
    return this.model.previewEditor;
  }

  get activeEditor(): EditorInput | null {
    return this.model.activeEditor;
  }

  get activeEditorPane(): IVisibleEditorPane | undefined {
    // Upstream asks `EditorPanes` (`editorPanes.ts:84`), so this forwards rather than
    // keeping a second copy that can lag behind the panes.
    return (this.editorPanes.activeEditorPane ?? undefined) as IVisibleEditorPane | undefined;
  }

  get whenRestored(): Promise<void> {
    return Promise.resolve();
  }

  /** prac draws the region's chrome (its tab strip), so the group has no title. */
  get titleHeight(): IEditorGroupTitleHeight {
    // Upstream's shape (`editorTitleControl.ts:197-204`): `total` is what the editor is
    // inset by, `offset` is where the progress bar sits. prac has no workbench tabs, so
    // the offset is 0 and the breadcrumbs are the whole title.
    const total = this.header?.height ?? 0;
    return { total, offset: 0 };
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
    // **One resource, one editor per group.** The app and the embedder can each
    // resolve their own input for a file, and two inputs for one resource do not
    // necessarily match each other (`TextResourceEditorInput` vs `FileEditorInput`),
    // so opening the second would put two editors for one file in the group's model
    // (measured: the `editors` capability reported one file two, four, six times).
    // The group's own editor therefore wins.
    const resource = editor.resource;
    const held =
      resource === undefined
        ? undefined
        : this.model
            .getEditors(EditorsOrder.SEQUENTIAL)
            .find((candidate) => candidate.resource?.toString() === resource.toString());
    const target = held ?? editor;
    this._onWillOpenEditor.fire({ editor: target, groupId: this.id });
    try {
      // **The preview/pinned derivation is upstream's** (`editorGroupView.ts:1201-1232`),
      // not a pass-through: `pinned` is what decides whether the editor the person opens
      // next *replaces* this one, and the part option `enablePreview` is the user's say
      // in it. Passing the caller's `pinned` straight through made every editor pinned,
      // so VS Code's preview semantics (the italic tab that the next single click
      // replaces) never happened.
      const openOptions: IEditorOpenOptions = {
        index: options ? options.index : undefined,
        pinned:
          options?.sticky === true ||
          (!this.groupsView.partOptions.enablePreview && !options?.transient) ||
          target.isDirty() ||
          (options?.pinned ?? typeof options?.index === "number") ||
          (typeof options?.index === "number" && this.model.isSticky(options.index)) ||
          target.hasCapability(EditorInputCapabilities.Scratchpad),
        sticky:
          options?.sticky === true ||
          (typeof options?.index === "number" && this.model.isSticky(options.index)),
        transient: !!options?.transient,
        inactiveSelection: internalOptions?.inactiveSelection,
        // Active unless the caller asked otherwise — the same intent the workbench's
        // group has. Without this the model only reports "editor opened", never
        // "active editor changed", and everything that follows the active editor (the
        // editor service's own events, the Outline, the Timeline) stays silent.
        active: this.count === 0 || !options?.inactive,
        supportSideBySide: internalOptions?.supportSideBySide,
      };
      // Which group the workbench should make *current* — upstream's three explicit
      // requests plus the default below (`editorGroupView.ts:1234-1245`). prac keeps
      // "the current region" in the host's active group, so honouring these is what
      // makes a command or an extension able to bring a region forward.
      let activateGroup = false;
      let restoreGroup = false;
      if (options?.activation === EditorActivation.ACTIVATE) {
        activateGroup = true;
      } else if (options?.activation === EditorActivation.RESTORE) {
        restoreGroup = true;
      } else if (options?.activation === EditorActivation.PRESERVE) {
        activateGroup = false;
        restoreGroup = false;
      } else if (openOptions.active) {
        // Only an editor opening as the active one moves the group, and preserving focus
        // means restating the group without taking focus to it.
        activateGroup = options?.preserveFocus !== true;
        restoreGroup = !activateGroup;
      }
      if (
        !openOptions.active &&
        !openOptions.pinned &&
        this.model.activeEditor &&
        !this.model.isPinned(this.model.activeEditor)
      ) {
        // Upstream's special case: opening inactive and unpinned while the active editor
        // is *also* unpinned means this editor will replace it, so it can only be active.
        openOptions.active = true;
      }
      this.model.openEditor(target, openOptions);
      const result = await this.editorPanes.openEditor(
        target,
        options,
        internalOptions,
        Object.create(null) as IEditorOpenContext,
      );
      if (result.error !== undefined) {
        this._onDidOpenEditorFail.fire(target);
        return undefined;
      }
      const pane = (result.pane ?? undefined) as IVisibleEditorPane | undefined;
      // Announce the active editor **here**, not from the model's change: upstream fires
      // this after `editorPane.openEditor` has resolved and only when the input actually
      // changed (`editorGroupView.ts:1300-1304`), because listeners ask
      // `activeEditorPane` in the handler and the pane is what makes the answer true.
      // Firing from the model change (which happens while the pane is still being
      // created) made the first file of a session unanswerable: the Outline asked, got
      // no pane, and had no reason to ask again — measured as "The active editor cannot
      // provide outline information." until another file was opened.
      if (result.changed === true) {
        this._onDidActiveEditorChange.fire({ editor: target, isExplicit: options?.isExplicit });
      }
      // Now that an editor is showing, the title area can be built: breadcrumbs decide
      // their visibility from the *active editor*, so creating it before there is one
      // left them hidden for good (measured: `.monaco-breadcrumbs` present with height 0
      // and no items).
      this.ensureHeader();
      this.header?.handleEditorsChange(true);
      this.relayout();
      if (activateGroup) {
        this.groupsView.activateGroup(this);
      } else if (restoreGroup) {
        this.groupsView.restoreGroup(this);
      }
      if (options?.preserveFocus !== true) {
        // The focus this raises is ours, not the person's: say so, because the
        // embedder turns `focusin` on a file's host into "the person is working in
        // this region" (`focusFile`).
        (this.groupsView as unknown as { noteSelfFocus?: () => void }).noteSelfFocus?.();
        pane?.focus();
      }
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
   * Close one editor, asking first when there is something to lose.
   *
   * The confirmation is upstream's shape (`editorGroupView.ts:1560-1580`): an editor
   * that cannot close is refused outright, a dirty one goes through
   * {@link handleCloseConfirmation}, and only then does the close happen. Without it a
   * dirty editor was closed silently — measured on the rig: typed into a file, called
   * the close action, and the file was gone with no dialog and no veto.
   *
   * @param editor - the editor to close; the active one when omitted.
   * @param options - close options (`force` skips the question).
   * @returns whether an editor was closed.
   */
  async closeEditor(editor?: EditorInput, options?: ICloseEditorOptions): Promise<boolean> {
    const candidate = editor ?? this.activeEditor ?? undefined;
    if (!candidate) return false;
    if (options?.force !== true && candidate.hasCapability(EditorInputCapabilities.CannotClose)) {
      return false;
    }
    if (await this.handleCloseConfirmation([candidate])) return false; // vetoed
    return this.doCloseEditor(candidate, options);
  }

  /**
   * The close itself, once nothing vetoes it.
   *
   * Mirrors the shipped group's order, because the order is load-bearing: the **model**
   * goes first, and only then the pane. Closing the active editor is not "dispose its
   * pane": the model promotes the next editor and that editor's pane has to be shown,
   * or the group is left with a disposed pane as its active one (`editorPanes` hides
   * the pane it holds, so closing one that another editor still replaces would leave
   * the group showing nothing). Upstream `EditorGroupView.doCloseActiveEditor` is the
   * reference this follows.
   *
   * @param candidate - the editor to close.
   * @param options - close options.
   * @returns whether the editor was closed.
   */
  private async doCloseEditor(
    candidate: EditorInput,
    options?: ICloseEditorOptions,
  ): Promise<boolean> {
    const wasActive = this.model.isActive(candidate);
    const event = { editor: candidate, groupId: this.id } as unknown as IEditorCloseEvent;
    this._onWillCloseEditor.fire(event);
    const result = this.model.closeEditor(candidate);
    if (result === undefined) {
      if (options?.force !== true) return false;
      this._onDidCloseEditor.fire(event);
      return true;
    }
    if (wasActive) {
      const next = this.model.activeEditor;
      if (next !== null && next !== undefined) {
        // Closing the active editor reveals the next one (upstream
        // `doCloseActiveEditor` -> `doOpenEditor(nextActiveEditor)`).
        await this.editorPanes.openEditor(
          next,
          { preserveFocus: options?.preserveFocus },
          undefined,
          Object.create(null) as IEditorOpenContext,
        );
      } else {
        this.editorPanes.closeEditor(candidate);
        // Upstream announces the now-empty group (`editorGroupView.ts:1682`); with the
        // next editor present the announcement comes from opening it, above.
        this._onDidActiveEditorChange.fire({ editor: undefined });
      }
    } else {
      this.editorPanes.closeEditor(candidate);
    }
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
    // Upstream asks about the whole list **before** closing any of it
    // (`editorGroupView.ts:1906-1922`), so a person answers the questions while
    // everything is still on screen.
    const closable = list.filter(
      (editor) =>
        options?.force === true || !editor.hasCapability(EditorInputCapabilities.CannotClose),
    );
    if (closable.length === 0) return true;
    if (await this.handleCloseConfirmation(closable.slice())) return false; // vetoed
    // Inactive editors first, the active one last — upstream's order
    // (`editorGroupView.ts:1953-1967`), and it is not cosmetic: closing the active
    // editor reveals the *next* one, so a list that still contains the editors being
    // closed must not have them re-shown on the way out.
    const inactive = closable.filter((editor) => !this.model.isActive(editor));
    const active = closable.filter((editor) => this.model.isActive(editor));
    let closed = true;
    for (const editor of [...inactive, ...active]) {
      closed = (await this.doCloseEditor(editor, options)) && closed;
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

  /** One in-flight confirmation per editor, so two closes never ask twice at once. */
  private readonly pendingConfirmations = new Map<EditorInput, Promise<boolean>>();

  /**
   * Ask about every editor that would lose something, one at a time.
   *
   * Upstream's shape (`editorGroupView.ts:1707-1730`), including the pending map: a
   * second close arriving while a dialog is open joins the first answer instead of
   * stacking a second dialog.
   *
   * @param editors - the editors about to close.
   * @returns whether any of them vetoed the close.
   */
  private async handleCloseConfirmation(editors: EditorInput[]): Promise<boolean> {
    if (editors.length === 0) return false; // no veto
    const [editor, ...rest] = editors as [EditorInput, ...EditorInput[]];
    let pending = this.pendingConfirmations.get(editor);
    if (pending === undefined) {
      pending = this.doHandleCloseConfirmation(editor);
      this.pendingConfirmations.set(editor, pending);
    }
    let veto = false;
    try {
      veto = await pending;
    } finally {
      this.pendingConfirmations.delete(editor);
    }
    // Stop at the first veto: a cancelled close must not go on asking.
    return veto ? true : this.handleCloseConfirmation(rest);
  }

  /**
   * One editor's question: save it, discard it, or leave it open.
   *
   * @param editor - the editor about to close.
   * @returns whether the close is vetoed.
   */
  private async doHandleCloseConfirmation(editor: EditorInput): Promise<boolean> {
    if (!this.shouldConfirmClose(editor)) return false; // no veto
    // Auto-save on focus change saves instead of asking, because a dialog would itself
    // steal focus (upstream `editorGroupView.ts:1781-1790`). prac bridges the user's
    // configuration, so the setting means the same thing here. The window-change case
    // upstream also handles is native-only and cannot arise in the browser.
    if (
      this.filesConfigurationService.getAutoSaveMode(editor).mode === AutoSaveMode.ON_FOCUS_CHANGE
    ) {
      await editor.save(this.id, { reason: SaveReason.FOCUS_CHANGE });
      return editor.isDirty();
    }
    // Show the editor being asked about, so the dialog refers to what is on screen
    // (upstream does the same before showing the dialog).
    if (this.activeEditor?.matches(editor) !== true) {
      await this.openEditor(editor, { preserveFocus: true });
    }
    const confirmation = await this.fileDialogService.showSaveConfirm([editor.getName()]);
    switch (confirmation) {
      case ConfirmResult.SAVE: {
        // `EditorInput.save` resolves to the saved input (not a boolean): the question
        // "did it work" is the same one the close asks — is it still dirty.
        await editor.save(this.id, { reason: SaveReason.EXPLICIT });
        return editor.isDirty(); // veto if it is still dirty
      }
      case ConfirmResult.DONT_SAVE: {
        try {
          await editor.revert(this.id);
          return editor.isDirty();
        } catch (error) {
          this.logService.error(error);
          // A soft revert still lets the editor close when reverting failed: the
          // person asked to discard, and refusing to close would trap the file.
          await editor.revert(this.id, { soft: true });
          return editor.isDirty();
        }
      }
      default:
        return true; // CANCEL vetoes
    }
  }

  /**
   * Whether closing this editor needs a question first.
   *
   * @param editor - the editor about to close.
   * @returns whether to ask.
   */
  private shouldConfirmClose(editor: EditorInput): boolean {
    if (editor.closeHandler) {
      try {
        return editor.closeHandler.showConfirm(); // the editor's own say
      } catch (error) {
        this.logService.error(error);
      }
    }
    return editor.isDirty() && !editor.isSaving();
  }

  /** The file dialog service, which shows the save confirmation. */
  private get fileDialogService(): IFileDialogService {
    return this.instantiationService.invokeFunction((accessor) => accessor.get(IFileDialogService));
  }

  /** The dialog service, which reports a move the editor itself refuses. */
  private get dialogService(): IDialogService {
    return this.instantiationService.invokeFunction((accessor) => accessor.get(IDialogService));
  }

  /** The files configuration service, which says whether auto-save is on. */
  private get filesConfigurationService(): IFilesConfigurationService {
    return this.instantiationService.invokeFunction((accessor) =>
      accessor.get(IFilesConfigurationService),
    );
  }

  //#region Moving an editor between prac groups (regions)

  /**
   * Move one editor into another group — upstream's semantics
   * (`editorGroupView.ts:1420-1510`): inside one group it is an order change, and
   * across groups it is "open in the target, then close here".
   *
   * This is what makes an editor *leave* a region when the file's view moves to
   * another one, instead of the region keeping a copy nobody shows.
   *
   * @param editor - the editor to move.
   * @param target - the group to move it to.
   * @param options - open options for the target.
   * @returns whether the move happened.
   */
  moveEditor(editor: EditorInput, target: IEditorGroup, options?: IEditorOptions): boolean {
    if (target === this) return this.moveEditorInsideGroup(editor, options);
    return this.doMoveOrCopyAcrossGroups(editor, target as PracEditorGroup, options, false);
  }

  /**
   * Move several editors into another group.
   *
   * @param editors - the editors with their options.
   * @param target - the group to move them to.
   * @returns whether every editor moved.
   */
  moveEditors(
    editors: { editor: EditorInput; options?: IEditorOptions }[],
    target: IEditorGroup,
  ): boolean {
    let moved = true;
    for (const { editor, options } of editors) {
      moved = this.moveEditor(editor, target, options) && moved;
    }
    return moved;
  }

  /**
   * Copy one editor into another group.
   *
   * A copy into the **same** group is a no-op here, and that is a deliberate
   * difference: prac keeps one editor per resource per group (see `openEditor`), so
   * the same file cannot appear twice side by side in one region.
   *
   * @param editor - the editor to copy.
   * @param target - the group to copy it to.
   * @param options - open options for the target.
   */
  copyEditor(editor: EditorInput, target: IEditorGroup, options?: IEditorOptions): void {
    if (target === this) return;
    this.doMoveOrCopyAcrossGroups(editor, target as PracEditorGroup, options, true);
  }

  /**
   * Copy several editors into another group.
   *
   * @param editors - the editors with their options.
   * @param target - the group to copy them to.
   */
  copyEditors(
    editors: { editor: EditorInput; options?: IEditorOptions }[],
    target: IEditorGroup,
  ): void {
    for (const { editor, options } of editors) this.copyEditor(editor, target, options);
  }

  /**
   * Reorder an editor inside this group (upstream `doMoveEditorInsideGroup`).
   *
   * @param editor - the editor to move.
   * @param options - the target index.
   * @returns whether anything changed.
   */
  private moveEditorInsideGroup(editor: EditorInput, options?: IEditorOptions): boolean {
    const index = options?.index;
    if (typeof index !== "number") return true; // nothing asked for: a no-op, not a failure
    const current = this.model.indexOf(editor);
    if (current === -1) return false;
    if (current !== index) {
      this.model.moveEditor(editor, index);
      this.model.pin(editor);
    }
    if (options?.sticky) this.stickEditor(editor);
    return true;
  }

  /**
   * The across-groups half of move and copy (upstream
   * `doMoveOrCopyEditorAcrossGroups`).
   *
   * @param editor - the editor to move or copy.
   * @param target - the destination group.
   * @param options - open options.
   * @param keepCopy - whether the source keeps its editor.
   * @returns whether it happened.
   */
  private doMoveOrCopyAcrossGroups(
    editor: EditorInput,
    target: PracEditorGroup,
    options: IEditorOptions | undefined,
    keepCopy: boolean,
  ): boolean {
    if (!keepCopy || editor.hasCapability(EditorInputCapabilities.Singleton)) {
      const veto = editor.canMove(this.id, target.id);
      if (typeof veto === "string") {
        // The editor refuses (a dirty diff editor, say): say so instead of moving
        // something the editor itself says cannot move.
        void this.dialogService.error(veto);
        return false;
      }
    }
    if (!keepCopy) {
      this._onWillMoveEditor.fire({ groupId: this.id, editor, target: target.id });
    }
    void target.openEditor(keepCopy ? editor.copy() : editor, {
      ...options,
      // A moved editor is pinned (upstream does the same): it is not a preview that
      // the next single click may replace.
      pinned: true,
      sticky: options?.sticky ?? (!keepCopy && this.model.isSticky(editor)),
    });
    if (!keepCopy) {
      // Close here without promoting a neighbour into focus: the editor did not close,
      // it moved, and the target is where it went.
      void this.doCloseEditor(editor, { preserveFocus: true });
    }
    return true;
  }

  //#region Still refused, with a log line

  async replaceEditors(_editors: IEditorReplacement[]): Promise<void> {
    this.logService.info(
      `vscode-embed: unsupported group operation — ${UNSUPPORTED_GROUP_OPERATIONS[0]}`,
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
  /**
   * The workbench's editor actions for this group's active editor.
   *
   * Upstream's own body (`editorGroupView.ts:2134-2176`): the `MenuId.EditorTitle` menu,
   * read for the active resource, plus the "Reopen Editor With" submenu. prac renders
   * these in the group header (see `ensureHeader`), which is where a person finds them
   * without upstream's tab bar.
   *
   * @param disposables - where the menu subscription lives.
   * @param menuId - the menu to read; `MenuId.EditorTitle` by default.
   * @returns the primary/secondary actions and a change event.
   */
  createEditorActions(
    disposables: DisposableStore,
    menuId: MenuId = MenuId.EditorTitle,
  ): IActiveEditorActions {
    let actions: PrimaryAndSecondaryActions = { primary: [], secondary: [] };
    let onDidChange: Event<IMenuChangeEvent | void> | undefined;
    const activeEditorPane = this.activeEditorPane;
    if (activeEditorPane instanceof EditorPane) {
      const contextKeyService =
        activeEditorPane.scopedContextKeyService ?? this.scopedContextKeyService;
      const menuService = this.instantiationService.invokeFunction((accessor) =>
        accessor.get(IMenuService),
      );
      const editorTitleMenu = disposables.add(
        menuService.createMenu(menuId, contextKeyService, {
          emitEventsForSubmenuChanges: true,
          eventDebounceDelay: 0,
        }),
      );
      onDidChange = editorTitleMenu.onDidChange;
      const shouldInlineGroup = (action: SubmenuAction, group: string) =>
        group === "navigation" && action.actions.length <= 1;
      actions = getActionBarActions(
        editorTitleMenu.getActions({
          arg: this.activeEditor?.resource,
          shouldForwardArgs: true,
          renderShortTitle: true,
        }),
        "navigation",
        shouldInlineGroup,
      );
      if (menuId === MenuId.EditorTitle) {
        const resolver = this.instantiationService.invokeFunction((accessor) =>
          accessor.get(IEditorResolverService),
        );
        const available = getAvailableEditorTypes(this.activeEditor, resolver);
        if (available) {
          const commands = this.instantiationService.invokeFunction((accessor) =>
            accessor.get(ICommandService),
          );
          const editorService = this.instantiationService.invokeFunction((accessor) =>
            accessor.get(IEditorService),
          );
          const editorTypeActions = createEditorTypeActions(
            available,
            resolver,
            commands,
            editorService,
          );
          const reopenWithSubmenu = new SubmenuAction(
            "editor.reopenWith",
            "Reopen Editor With",
            editorTypeActions,
          );
          if (actions.secondary.length) actions.secondary.push(new Separator());
          actions.secondary.push(reopenWithSubmenu);
        }
      }
    } else {
      const onDidChangeEmitter = disposables.add(new Emitter<void>());
      onDidChange = onDidChangeEmitter.event;
      disposables.add(this.onDidActiveEditorChange(() => onDidChangeEmitter.fire()));
    }
    return { actions, onDidChange };
  }

  /** Re-read the editor actions for the active editor into the toolbar. */
  private updateEditorActions(): void {
    if (this.actionsBar === undefined) return;
    this.actionsDisposables.clear();
    const { actions, onDidChange } = this.createEditorActions(
      this.actionsDisposables,
      MenuId.EditorTitle,
    );
    this.actionsBar.setActions(actions.primary, actions.secondary);
    if (onDidChange !== undefined) {
      this.actionsDisposables.add(onDidChange(() => this.updateEditorActions()));
    }
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
    // The title spans the full width; the editor follows it (upstream
    // `editorGroupView.ts:2232-2252`).
    // The header is created when the first editor opens (see `ensureHeader`), so a group
    // that is laid out before that simply has no title yet.
    // The breadcrumbs take the room the actions leave them: upstream lays them out over
    // the full width because its tab bar holds the actions, while here they share the row.
    const actionsWidth = this.actionsElement?.offsetWidth ?? 0;
    this.header?.layout(Math.max(0, width - actionsWidth));
    const titleHeight = this.titleHeight.total;
    this.titleElement.style.height = `${titleHeight}px`;
    this.progressBar.getContainer().style.top = `${Math.max(this.titleHeight.offset - 2, 0)}px`;
    const editorHeight = Math.max(0, height - titleHeight);
    this.editorContainer.style.height = `${editorHeight}px`;
    this.editorPanes.layout({ width, height: editorHeight, top: top + titleHeight, left });
    this._onDidChange.fire({ width, height });
  }

  /**
   * The title area's control, created when the first editor is shown.
   *
   * `showHeader: false` means "breadcrumbs below the tabs, no title actions": prac has
   * no workbench tabs — the region's strip is the tab strip — so the header carries only
   * what belongs to the editor itself.
   *
   * @returns the header control.
   */
  private ensureHeader(): EditorHeaderControl {
    if (this.header === undefined) {
      this.header = this._register(
        this.instantiationService.createInstance(
          EditorHeaderControl,
          this.titleElement,
          this,
          this.groupsView,
          undefined,
          false,
        ),
      );
      // The editor actions (split, pin, close, `…`) belong to the tab bar upstream
      // (`editorTabsControl.ts:391` renders them into `.editor-actions`); prac's tab bar
      // is the frame's, so they live at the **right end of the group header** instead of
      // being absent. The actions themselves are the workbench's — `MenuId.EditorTitle`,
      // the same menu — so what appears is VS Code's own list.
      this.actionsElement = document.createElement("div");
      this.actionsElement.classList.add("prac-editor-actions");
      this.actionsElement.style.cssText =
        "display:flex;flex:0 0 auto;align-items:center;padding-left:6px";
      this.titleElement.style.cssText = "display:flex;align-items:center;position:relative";
      this.titleElement.append(this.actionsElement);
      const contextMenu = this.instantiationService.invokeFunction((accessor) =>
        accessor.get(IContextMenuService),
      );
      this.actionsBar = this._register(
        new ToolBar(this.actionsElement, contextMenu, { ariaLabel: "Editor actions" }),
      );
      this.updateEditorActions();
    }
    return this.header;
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
    this.activeEditorPane?.focus();
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
    // The title area follows the model the same way upstream's title control does.
    this.header?.handleEditorsChange(event.kind !== GroupModelChangeKind.EDITOR_ACTIVE);
    if (event.kind === GroupModelChangeKind.EDITOR_ACTIVE) this.updateEditorActions();
    // Nothing to do: the model's changes reach the outside through `onDidModelChange`
    // (the editor service subscribes to it), and the **active editor** is announced by
    // `openEditor`/`closeEditor` once the pane exists — the order upstream uses.
  }
}
