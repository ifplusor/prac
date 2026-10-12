/**
 * prac's **editor host** — the workbench-facing side of prac's own editor area.
 *
 * The workbench's editor *part* is what upstream provides here, and it cannot be
 * borrowed: it is a grid of groups that cannot hold prac views, and it is the thing
 * that had to be created off-screen just to keep the editor service alive (James
 * 2026-10-07: 「不要保留离屏部件，它会成为沉重的债务」). So prac is the host: this
 * class implements the service the workbench injects, the "main part" it delegates
 * to, and the two host views a group needs — on top of **prac's region tree**, which
 * is the editor grid:
 *
 * - a region that holds files owns one {@link PracEditorGroup};
 * - splitting a region is how a second group is born;
 * - `activeGroup` is the group of the region prac has focus in.
 *
 * Everything that only makes sense for a real grid of groups (moving/copying/merging
 * groups, maximising, arranging, auxiliary windows, working sets) is **refused with a
 * log line** rather than faked; the list is {@link UNSUPPORTED_HOST_OPERATIONS}. What
 * *is* real: the group registry, the active group, adding/removing groups (the
 * embedder calls those as regions come and go), and `partOptions` — which is the
 * workbench's own `getEditorPartOptions` reading the user's configuration, so the
 * editor behaves as configured.
 *
 * This file lives in the upstream-tree payload (see `.eslintignore`): it imports
 * `vs/...` internals by relative path and is compiled inside the checkout.
 *
 * @module prac/vscode/overlay/pracEditorHost
 */
import { Emitter, Event } from "../../base/common/event.js";
import { Disposable, IDisposable, toDisposable } from "../../base/common/lifecycle.js";
import { mainWindow } from "../../base/browser/window.js";
import { Dimension, IDimension } from "../../base/browser/dom.js";
import { IConfigurationService } from "../../platform/configuration/common/configuration.js";
import {
  ContextKeyValue,
  IContextKey,
  RawContextKey,
} from "../../platform/contextkey/common/contextkey.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { ILogService } from "../../platform/log/common/log.js";
import { IThemeService } from "../../platform/theme/common/themeService.js";
import {
  IEditorGroupView,
  IEditorGroupsView,
  IEditorPartCreationOptions,
  IEditorPartsView,
  getEditorPartOptions,
  impactsEditorPartOptions,
} from "./parts/editor/editor.js";
import { EditorInput } from "../common/editor/editorInput.js";
import { IEditorOptions, IModalEditorPartOptions } from "../../platform/editor/common/editor.js";
import {
  GroupIdentifier,
  IEditorPartOptions,
  IEditorPartOptionsChangeEvent,
  IVisibleEditorPane,
} from "../common/editor.js";
import {
  EditorGroupLayout,
  GroupActivationReason,
  GroupDirection,
  GroupOrientation,
  GroupsArrangement,
  GroupLocation,
  GroupsOrder,
  IEditorDropTargetDelegate,
  IEditorGroup,
  IEditorGroupActivationEvent,
  IEditorGroupContextKeyProvider,
  IEditorPart,
  IEditorSideGroup,
  IEditorWorkingSet,
  IEditorWorkingSetOptions,
  IFindGroupScope,
  IModalEditorPart,
  IAuxiliaryEditorPart,
  IEditorGroupsService,
} from "../services/editor/common/editorGroupsService.js";
import { PracEditorGroup } from "./pracEditorGroup.js";
import { DeepPartial } from "../../base/common/types.js";

/**
 * Everything this host refuses, and why.
 *
 * Each entry belongs to a real grid of editor groups; prac's grid is its region tree,
 * so the mapping is a decision of its own. The host logs instead of pretending.
 */
export const UNSUPPORTED_HOST_OPERATIONS = [
  "moveGroup/copyGroup/mergeGroup/mergeAllGroups",
  "arrangeGroups/toggleMaximizeGroup/toggleExpandGroup/applyLayout/setGroupOrientation",
  "createAuxiliaryEditorPart/createModalEditorPart",
  "working sets (save/get/apply/delete)",
  "createEditorDropTarget (dragging an editor onto a group)",
] as const;

/**
 * prac's editor host: the editor service, its part, and the hosts a group asks for.
 */
/**
 * The app's region channel, installed by the embedder once prac's frame is up.
 *
 * `addGroup` is synchronous and the workbench asks for a group before any view exists for it,
 * so the answer has to come back in the same tick: the frame's tree is a store update, and it
 * hands the new region's id back. The channel lives at module scope because there is exactly
 * one embedded workbench per page and the host is built through the service collection, which
 * has no seam for an app-supplied callback.
 */
/** prac's split sides, as the workbench's directions map onto them. */
export type PracSide = "left" | "right" | "up" | "down";

/** What the workbench asks the frame, because the region tree is the frame's. */
export interface GroupRegionChannel {
  /** Split a region and return the new region's id, or undefined when it cannot. */
  createRegionBeside(region: string, side: PracSide): string | undefined;
  /** The region adjacent to another one in a direction, or undefined when there is none. */
  regionInDirection(region: string, side: PracSide): string | undefined;
}

let groupRegionChannel: GroupRegionChannel | undefined;

/**
 * Install the app's region channel (see {@link groupRegionChannel}).
 *
 * @param channel - the frame's answers, as synchronous questions.
 */
export function setGroupRegionChannel(channel: GroupRegionChannel): void {
  groupRegionChannel = channel;
}

/** prac's split side for an upstream group direction. */
function sideOfDirection(direction: GroupDirection): "left" | "right" | "up" | "down" {
  switch (direction) {
    case GroupDirection.LEFT:
      return "left";
    case GroupDirection.RIGHT:
      return "right";
    case GroupDirection.UP:
      return "up";
    default:
      return "down";
  }
}

export class PracEditorHost
  extends Disposable
  implements IEditorGroupsService, IEditorGroupsView, IEditorPartsView, IEditorPart
{
  declare readonly _serviceBrand: undefined;

  readonly windowId = mainWindow.vscodeWindowId;

  private readonly _groups: PracEditorGroup[] = [];
  /** The region each group belongs to, by the group's own id. */
  private readonly _regions = new Map<GroupIdentifier, string>();
  private _activeGroup: PracEditorGroup | undefined;
  private _partOptions: IEditorPartOptions;
  private _dimension: IDimension = new Dimension(0, 0);

  private readonly _onDidChangeActiveGroup = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidAddGroup = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidRemoveGroup = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidMoveGroup = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidActivateGroup = this._register(new Emitter<IEditorGroupActivationEvent>());
  private readonly _onDidChangeGroupIndex = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidChangeGroupLocked = this._register(new Emitter<IEditorGroup>());
  private readonly _onDidChangeGroupMaximized = this._register(new Emitter<boolean>());
  private readonly _onDidChangeEditorPartOptions = this._register(
    new Emitter<IEditorPartOptionsChangeEvent>(),
  );
  private readonly _onDidLayout = this._register(new Emitter<IDimension>());
  private readonly _onDidScroll = this._register(new Emitter<void>());
  private readonly _onWillDispose = this._register(new Emitter<void>());
  /** Never fires: prac's frame owns visibility of a region, not this host. */
  private readonly _onDidVisibilityChange = this._register(new Emitter<boolean>());

  readonly onDidChangeActiveGroup = this._onDidChangeActiveGroup.event;
  readonly onDidAddGroup = this._onDidAddGroup.event;
  readonly onDidRemoveGroup = this._onDidRemoveGroup.event;
  readonly onDidMoveGroup = this._onDidMoveGroup.event;
  readonly onDidActivateGroup = this._onDidActivateGroup.event;
  readonly onDidChangeGroupIndex = this._onDidChangeGroupIndex.event;
  readonly onDidChangeGroupLocked = this._onDidChangeGroupLocked.event;
  readonly onDidChangeGroupMaximized = this._onDidChangeGroupMaximized.event;
  readonly onDidChangeEditorPartOptions = this._onDidChangeEditorPartOptions.event;
  readonly onDidLayout = this._onDidLayout.event;
  readonly onDidScroll = this._onDidScroll.event;
  readonly onWillDispose = this._onWillDispose.event;
  readonly onDidVisibilityChange = this._onDidVisibilityChange.event;

  readonly isReady = true;
  readonly whenReady: Promise<void> = Promise.resolve();
  readonly whenRestored: Promise<void> = Promise.resolve();
  /** prac owns layout state (its frame's), so the host has none to restore. */
  readonly hasRestorableState = false;
  readonly activeModalEditorPart: IModalEditorPart | undefined = undefined;
  readonly onDidCreateAuxiliaryEditorPart = Event.None as Event<IAuxiliaryEditorPart>;

  /** prac's split is a property of a *region*, so the host has one orientation. */
  readonly orientation = GroupOrientation.HORIZONTAL;

  get mainPart(): IEditorPart & IEditorGroupsView {
    return this;
  }

  get parts(): ReadonlyArray<IEditorPart> {
    return [this];
  }

  get count(): number {
    return this._groups.length;
  }

  /** Until when the host itself is moving focus (see {@link noteSelfFocus}). */
  private selfFocusUntil = 0;

  /**
   * Note that the host is moving focus itself, right now.
   *
   * Opening an editor focuses its pane, and that focus is not the person choosing a
   * region — but it does raise `focusin` on whatever element the pane sits in, which
   * the embedder reads as "the person is working here" and turns into `focusFile`.
   * Measured: that made `focusFile` and the client's activate reconciliation fight
   * forever when a file was closed and re-opened (the page's main thread never came
   * back). A short window is enough: the focus event follows the call.
   *
   * @param durationMs - how long the window lasts.
   */
  noteSelfFocus(durationMs = 500): void {
    this.selfFocusUntil = Date.now() + durationMs;
  }

  /**
   * Whether a focus event arriving now is the host's own making.
   *
   * @returns whether {@link noteSelfFocus} was called within its window.
   */
  isSelfFocus(): boolean {
    return Date.now() < this.selfFocusUntil;
  }

  get groups(): IEditorGroupView[] {
    return this._groups;
  }

  get activeGroup(): IEditorGroupView {
    return this._requireActiveGroup();
  }

  get partOptions(): IEditorPartOptions {
    return this._partOptions;
  }

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IConfigurationService private readonly configurationService: IConfigurationService,
    @IThemeService private readonly themeService: IThemeService,
    @ILogService private readonly logService: ILogService,
  ) {
    super();
    this._partOptions = getEditorPartOptions(this.configurationService, this.themeService);
    this._register(
      this.configurationService.onDidChangeConfiguration((event) => {
        if (impactsEditorPartOptions(event)) this.updatePartOptions();
      }),
    );
    this._register(this.themeService.onDidColorThemeChange(() => this.updatePartOptions()));

    // The editor area always has **one** group, created here rather than on first
    // use: the editor service registers its per-group listeners while restoring
    // (`onEditorGroupsReady` walks the groups it sees) and only picks up later ones
    // through `onDidAddGroup`. A group created lazily *after* that walk is therefore
    // never listened to — measured: opening a file then changed nothing any observer
    // could see (no `onDidChangeOpenFiles`, so prac never placed a file view).
    this._activeGroup = this.ensureGroup("stage", "stage");
  }

  //#region The group registry (real)

  /**
   * Create a group for a region, or return the one that region already has.
   *
   * The embedder calls this when a region takes its first file; the region is the
   * group's identity, so the label is the region's.
   *
   * @param region - the region id the group belongs to.
   * @param label - the label prac shows for that region.
   * @returns the group.
   */
  ensureGroup(region: string, label: string): PracEditorGroup {
    const existing = this._groups.find((group) => this._regions.get(group.id) === region);
    if (existing !== undefined) return existing;
    const group = this._register(
      new PracEditorGroup(
        this,
        this.instantiationService,
        this.logService,
        label,
        this._groups.length,
      ),
    );
    this._regions.set(group.id, region);
    this._groups.push(group);
    this._onDidAddGroup.fire(group);
    if (this._activeGroup === undefined) this.setActiveGroup(group, false);
    return group;
  }

  /**
   * Drop a region's group (the region is gone or holds no files any more).
   *
   * @param region - the region id the group belonged to.
   */
  removeGroupByRegion(region: string): void {
    const group = this._groups.find((candidate) => this._regions.get(candidate.id) === region);
    if (group === undefined) return;
    this.removeGroup(group);
  }

  getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined {
    return this._groups.find((group) => group.id === identifier);
  }

  /**
   * The group with this identifier, typed as prac's own group.
   *
   * {@link getGroup} answers the interface's question (`IEditorGroupView | undefined`);
   * a caller that holds an identifier the embedder named wants prac's group, because
   * that is the object whose element and region the host moves.
   *
   * @param identifier - the group's identifier.
   * @returns the group, or `undefined` when the host never made one.
   */
  groupById(identifier: number): PracEditorGroup | undefined {
    return this._groups.find((group) => group.id === identifier);
  }

  /**
   * Record that a group is now shown in another region.
   *
   * A group's element moves with its view (see `mountFileInto`): the region is where
   * the group is *shown*, not what the group is, so a view that moved regions keeps its
   * group — and therefore its identity — and only this mapping changes. The mapping is
   * what the `editors` capability reports as a placement's region and what
   * {@link removeGroupByRegion} looks a group up by, so it has to follow the element.
   *
   * @param group - the group that moved.
   * @param region - the region it is shown in now.
   */
  rehomeGroup(group: PracEditorGroup, region: string): void {
    this._regions.set(group.id, region);
  }

  /**
   * The group that belongs to a prac region, if that region holds files.
   *
   * @param region - the region id.
   * @returns the group, or `undefined`.
   */
  groupForRegion(region: string): PracEditorGroup | undefined {
    return this._groups.find((group) => this._regions.get(group.id) === region);
  }

  /**
   * The prac region a group belongs to.
   *
   * The reverse of {@link groupForRegion}, for a caller that holds the group and needs
   * to name the region (removing it, laying it out, reporting it).
   *
   * @param group - the group.
   * @returns the region id, or `undefined` for a group that is not registered.
   */
  regionOf(group: PracEditorGroup): string | undefined {
    return this._regions.get(group.id);
  }

  getGroups(order: GroupsOrder = GroupsOrder.CREATION_TIME): IEditorGroupView[] {
    if (order === GroupsOrder.MOST_RECENTLY_ACTIVE) {
      return [
        this._requireActiveGroup(),
        ...this._groups.filter((group) => group !== this._activeGroup),
      ];
    }
    return [...this._groups];
  }

  getSize(group: GroupIdentifier): { width: number; height: number } {
    const box = this.groupElement(group)?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  }

  setSize(group: GroupIdentifier, size: { width: number; height: number }): void {
    const element = this.groupElement(group);
    if (element === undefined) return;
    this.layoutGroup(group, { width: size.width, height: size.height });
  }

  /**
   * The element prac mounted a group into, if it has one yet.
   *
   * @param group - the group or its identifier.
   * @returns the host element, or `undefined` before the embedder mounted it.
   */
  private groupElement(group: GroupIdentifier): HTMLElement | undefined {
    const resolved = this.getGroup(group);
    return resolved === undefined ? undefined : (resolved as PracEditorGroup).host;
  }

  /**
   * Lay one group out in the box prac gave its region.
   *
   * @param group - the group or its identifier.
   * @param box - the box, in the region's own coordinates.
   */
  layoutGroup(group: GroupIdentifier, box: { width: number; height: number }): void {
    const resolved = this.getGroup(group);
    if (resolved === undefined) return;
    (resolved as PracEditorGroup).layout(box.width, box.height, 0, 0);
    this._dimension = new Dimension(box.width, box.height);
    this._onDidLayout.fire(this._dimension);
  }

  activateGroup(group: IEditorGroup | GroupIdentifier): IEditorGroupView {
    const resolved = typeof group === "number" ? this.getGroup(group) : (group as PracEditorGroup);
    if (resolved === undefined) return this._requireActiveGroup();
    this.setActiveGroup(resolved as PracEditorGroup, true);
    return resolved;
  }

  restoreGroup(group: IEditorGroup | GroupIdentifier): IEditorGroupView {
    return this.activateGroup(group);
  }

  addGroup(
    location: IEditorGroupView | GroupIdentifier,
    direction: GroupDirection,
  ): IEditorGroupView {
    // In prac a group *is* a region, so adding a group means asking the frame for a region
    // in that direction and binding the group to it. The channel is the app's (the frame owns
    // the tree); without it there is nothing to add and the active group is the honest answer.
    const source =
      typeof location === "number" ? this.getGroup(location) : (location as PracEditorGroup);
    const from = source ?? this._activeGroup;
    const region = from === undefined ? undefined : this.regionOf(from as PracEditorGroup);
    const side = sideOfDirection(direction);
    const created =
      region === undefined || groupRegionChannel === undefined
        ? undefined
        : groupRegionChannel.createRegionBeside(region, side);
    if (created === undefined) {
      this.logService.info(
        "vscode-embed: addGroup — no app region channel (or no source region); the active group is returned",
      );
      return this._requireActiveGroup();
    }
    return this.ensureGroup(created, created);
  }

  removeGroup(group: IEditorGroupView | GroupIdentifier): void {
    const resolved = (typeof group === "number" ? this.getGroup(group) : group) as
      | PracEditorGroup
      | undefined;
    if (resolved === undefined) return;
    const index = this._groups.indexOf(resolved);
    if (index >= 0) this._groups.splice(index, 1);
    this._regions.delete(resolved.id);
    resolved.dispose();
    this._onDidRemoveGroup.fire(resolved);
    this._groups.forEach((candidate, position) => candidate.notifyIndexChanged(position));
    if (this._activeGroup === resolved) this._activeGroup = this._groups[0];
    if (this._activeGroup !== undefined) this._onDidChangeActiveGroup.fire(this._activeGroup);
  }

  /**
   * The group of the region prac has focus in, if any.
   *
   * @returns the active group.
   */
  private _requireActiveGroup(): PracEditorGroup {
    if (this._activeGroup === undefined) {
      // No region holds files yet: make one, so the editor service always has a group
      // to open into. The embedder relabels it as soon as a region claims it.
      return this.ensureGroup("stage", "stage");
    }
    return this._activeGroup;
  }

  private setActiveGroup(group: PracEditorGroup, explicit: boolean): void {
    const previous = this._activeGroup;
    if (previous !== undefined) previous.setActive(false);
    this._activeGroup = group;
    group.setActive(true);
    if (previous !== group) this._onDidChangeActiveGroup.fire(group);
    if (explicit) this._onDidActivateGroup.fire({ group, reason: GroupActivationReason.DEFAULT });
  }

  /**
   * Find a group by location, the way upstream's part does
   * (`editorPart.ts:385-412`).
   *
   * **Order-based locations are real**: FIRST/LAST are the ends of the group list and
   * NEXT/PREVIOUS step through it, which is what the workbench's "move/split editor into
   * the next group" commands ask for. Directional lookups (LEFT/RIGHT/UP/DOWN) need the
   * *geometry* of prac's region tree, which belongs to the frame and cannot be read
   * synchronously here — those return `undefined`, so a caller that wanted a new group
   * falls back to `addGroup`, which is accounted for separately.
   *
   * @param scope - what to look for.
   * @param source - the group to look from; the active one by default.
   * @param wrap - whether NEXT/PREVIOUS wrap around the ends.
   * @returns the group, or `undefined`.
   */
  findGroup(
    scope: IFindGroupScope,
    source?: IEditorGroup | GroupIdentifier,
    wrap?: boolean,
  ): IEditorGroupView | undefined {
    const groups = this.getGroups(GroupsOrder.GRID_APPEARANCE);
    if (scope.location === GroupLocation.FIRST) return groups[0];
    if (scope.location === GroupLocation.LAST) return groups[groups.length - 1];
    if (scope.location === GroupLocation.NEXT || scope.location === GroupLocation.PREVIOUS) {
      const from =
        source === undefined
          ? this._activeGroup
          : typeof source === "number"
            ? this.getGroup(source)
            : (source as IEditorGroupView);
      const index = from === undefined ? -1 : groups.indexOf(from);
      if (index === -1) return undefined;
      const step = scope.location === GroupLocation.NEXT ? 1 : -1;
      const found = groups[index + step];
      if (found !== undefined) return found;
      return wrap === true ? (step === 1 ? groups[0] : groups[groups.length - 1]) : undefined;
    }
    if (typeof scope.direction === "number") {
      // Directional lookups are geometry, and the tree is the frame's (see the channel above).
      const from =
        source === undefined
          ? this._activeGroup
          : typeof source === "number"
            ? this.getGroup(source)
            : (source as IEditorGroupView);
      const region = from === undefined ? undefined : this.regionOf(from as PracEditorGroup);
      const neighbour =
        region === undefined || groupRegionChannel === undefined
          ? undefined
          : groupRegionChannel.regionInDirection(region, sideOfDirection(scope.direction));
      if (neighbour === undefined) {
        this.logService.info(
          `vscode-embed: directional group lookup (${scope.direction}) found no neighbour`,
        );
        return undefined;
      }
      return this.groupForRegion(neighbour);
    }
    if (source === undefined) return this._requireActiveGroup();
    return typeof source === "number" ? this.getGroup(source) : (source as IEditorGroupView);
  }

  //#endregion

  //#region Refused grid operations (each with a log line)

  arrangeGroups(_arrangement: GroupsArrangement, _target?: IEditorGroup | GroupIdentifier): void {
    this.refuse(1);
  }

  toggleMaximizeGroup(_group?: IEditorGroup | GroupIdentifier): void {
    this.refuse(1);
  }

  toggleExpandGroup(_group?: IEditorGroup | GroupIdentifier): void {
    this.refuse(1);
  }

  applyLayout(_layout: EditorGroupLayout): void {
    this.refuse(1);
  }

  getLayout(): EditorGroupLayout {
    return { orientation: GroupOrientation.HORIZONTAL, groups: [] };
  }

  setGroupOrientation(_orientation: GroupOrientation): void {
    this.refuse(1);
  }

  moveGroup(
    _group: IEditorGroup | GroupIdentifier,
    _location: IEditorGroup | GroupIdentifier,
    _direction: GroupDirection,
  ): IEditorGroupView {
    this.refuse(0);
    return this._requireActiveGroup();
  }

  copyGroup(
    _group: IEditorGroup | GroupIdentifier,
    _location: IEditorGroup | GroupIdentifier,
    _direction: GroupDirection,
  ): IEditorGroupView {
    this.refuse(0);
    return this._requireActiveGroup();
  }

  mergeGroup(
    _group: IEditorGroup | GroupIdentifier,
    _target: IEditorGroup | GroupIdentifier,
    _options?: unknown,
  ): boolean {
    this.refuse(0);
    return false;
  }

  mergeAllGroups(_target: IEditorGroup | GroupIdentifier): boolean {
    this.refuse(0);
    return false;
  }

  createEditorDropTarget(_container: unknown, _delegate: IEditorDropTargetDelegate): IDisposable {
    this.refuse(4);
    return toDisposable(() => undefined);
  }

  enforcePartOptions(_options: DeepPartial<IEditorPartOptions>): IDisposable {
    this.logService.info("vscode-embed: enforcePartOptions is not implemented");
    return toDisposable(() => undefined);
  }

  registerContextKeyProvider<T extends ContextKeyValue>(
    _provider: IEditorGroupContextKeyProvider<T>,
  ): IDisposable {
    this.logService.info("vscode-embed: registerContextKeyProvider is not implemented");
    return toDisposable(() => undefined);
  }

  private refuse(index: number): void {
    this.logService.info(
      `vscode-embed: unsupported editor host operation — ${UNSUPPORTED_HOST_OPERATIONS[index]}`,
    );
  }

  //#endregion

  //#region The part / service extras

  getPart(_group: IEditorGroup | GroupIdentifier): IEditorPart;
  getPart(_container: unknown): IEditorPart;
  getPart(): IEditorPart {
    return this;
  }

  getScopedInstantiationService(_part: IEditorPart): IInstantiationService {
    return this.instantiationService;
  }

  async createAuxiliaryEditorPart(
    _options?:
      | IEditorPartCreationOptions
      | { bounds?: unknown; compact?: boolean; alwaysOnTop?: boolean },
  ): Promise<IAuxiliaryEditorPart> {
    this.refuse(2);
    throw new Error("prac has no auxiliary editor parts");
  }

  async createModalEditorPart(_options?: IModalEditorPartOptions): Promise<IModalEditorPart> {
    this.refuse(2);
    throw new Error("prac has no modal editor parts");
  }

  saveWorkingSet(_name: string): IEditorWorkingSet {
    this.refuse(3);
    throw new Error("prac has no working sets");
  }

  getWorkingSets(): IEditorWorkingSet[] {
    return [];
  }

  async applyWorkingSet(
    _workingSet: IEditorWorkingSet | "empty",
    _options?: IEditorWorkingSetOptions,
  ): Promise<boolean> {
    this.refuse(3);
    return false;
  }

  deleteWorkingSet(_workingSet: IEditorWorkingSet): void {
    this.refuse(3);
  }

  get sideGroup(): IEditorSideGroup {
    return {
      openEditor: (editor: EditorInput, options?: IEditorOptions) =>
        this._requireActiveGroup().openEditor(editor, options) as Promise<
          IVisibleEditorPane | undefined
        >,
    };
  }

  //#endregion

  //#region The part's layout members (prac's frame does the laying out)

  get contentDimension(): IDimension {
    return this._dimension;
  }

  hasMaximizedGroup(): boolean {
    return false;
  }

  centerLayout(_active: boolean): void {
    this.logService.info("vscode-embed: centered layout is not implemented");
  }

  isLayoutCentered(): boolean {
    return false;
  }

  //#endregion

  //#region The parts view (one part: prac's)

  registerPart(_part: IEditorPart): IDisposable {
    this.logService.info("vscode-embed: registerPart is not implemented (prac has one part)");
    return toDisposable(() => undefined);
  }

  bind<T extends ContextKeyValue>(
    contextKey: RawContextKey<T>,
    group: IEditorGroupView,
  ): IContextKey<T> {
    return contextKey.bindTo((group as PracEditorGroup).scopedContextKeyService) as IContextKey<T>;
  }

  //#endregion

  override dispose(): void {
    this._onWillDispose.fire();
    super.dispose();
  }

  private updatePartOptions(): void {
    const previous = this._partOptions;
    const next = getEditorPartOptions(this.configurationService, this.themeService);
    this._partOptions = next;
    this._onDidChangeEditorPartOptions.fire({ oldPartOptions: previous, newPartOptions: next });
  }
}
