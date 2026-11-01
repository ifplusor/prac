/**
 * The embedded workbench: VS Code's parts mounted into hosts the embedder owns.
 *
 * Instead of VS Code's classic Workbench/Layout (grid-coupled), this file provides an
 * `EmbeddedWorkbench` that implements `IWorkbenchLayoutService` itself and mounts each part
 * into an *external host container* — a DOM region the embedder's shell renders.
 * The workbench is *hosted*, never in charge of composition.
 *
 * A part is placed by looking up `[data-vscode-embed-part-host="<part id>"]` in the document;
 * parts without an external host fall back to the main container. Layout is driven by the host
 * container's own box, so the embedder owns composition while VS Code owns parts/services.
 *
 * This is the first slice: enough to boot, register parts, mount them externally and lay
 * them out. Layout semantics the embedder does not use yet (zen, centered layout, floating
 * panels, multi-window, maximized panels) are intentionally minimal.
 */

import {
  Disposable,
  DisposableStore,
  IDisposable,
  toDisposable,
} from "../../base/common/lifecycle.js";
import { Emitter, Event } from "../../base/common/event.js";
import { RunOnceScheduler } from "../../base/common/async.js";
import { Dimension, IDimension, runWhenWindowIdle } from "../../base/browser/dom.js";
import { mainWindow } from "../../base/browser/window.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { InstantiationService } from "../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../platform/instantiation/common/serviceCollection.js";
import { SyncDescriptor } from "../../platform/instantiation/common/descriptors.js";
import { getSingletonServiceDescriptors } from "../../platform/instantiation/common/extensions.js";
import { ILayoutOffsetInfo, ILayoutService } from "../../platform/layout/browser/layoutService.js";
import { ContextViewService } from "../../platform/contextview/browser/contextViewService.js";
import {
  IContextViewDelegate,
  IContextViewService,
  IOpenContextView,
} from "../../platform/contextview/browser/contextView.js";
import { ILogService } from "../../platform/log/common/log.js";
import { IStorageService } from "../../platform/storage/common/storage.js";
import { IConfigurationService } from "../../platform/configuration/common/configuration.js";
import { IThemeService } from "../../platform/theme/common/themeService.js";
import { IHostService } from "../services/host/browser/host.js";
import { INotificationService } from "../../platform/notification/common/notification.js";
import { ICommandService } from "../../platform/commands/common/commands.js";
import { IViewsService } from "../../workbench/services/views/common/viewsService.js";
import { SubmenuAction } from "../../base/common/actions.js";
import type { IAction } from "../../base/common/actions.js";
import { ViewContainerMenuActions } from "../../workbench/browser/parts/views/viewMenuActions.js";
import { ViewsService } from "../../workbench/services/views/browser/viewsService.js";
import { IEditorService } from "../services/editor/common/editorService.js";
import { IEditorResolverService } from "../services/editor/common/editorResolverService.js";
import { IUntitledTextEditorService } from "../services/untitled/common/untitledTextEditorService.js";
import { URI } from "../../base/common/uri.js";
import { IEditorGroupsService } from "../services/editor/common/editorGroupsService.js";
import type { EditorInput } from "../common/editor/editorInput.js";
import { IPaneCompositePartService } from "../services/panecomposite/browser/panecomposite.js";
import { IViewDescriptorService, IView, ViewContainerLocationToString } from "../common/views.js";
import { ITitleService } from "../services/title/browser/titleService.js";
import { IStatusbarService } from "../services/statusbar/browser/statusbar.js";
import { IBannerService } from "../services/banner/browser/bannerService.js";
import { IWorkspaceContextService } from "../../platform/workspace/common/workspace.js";
import { ITelemetryService } from "../../platform/telemetry/common/telemetry.js";
import { IFileService } from "../../platform/files/common/files.js";
import {
  ILifecycleService,
  LifecyclePhase,
  WillShutdownEvent,
} from "../services/lifecycle/common/lifecycle.js";
import { IBrowserWorkbenchEnvironmentService } from "../services/environment/browser/environmentService.js";
import { onUnexpectedError } from "../../base/common/errors.js";
import { Direction, Grid, ISerializableView, IViewSize } from "../../base/browser/ui/grid/grid.js";
import { Part } from "./part.js";
import { ViewPane } from "./parts/views/viewPane.js";
import { PracWindowGroupHost, setGroupRegionChannel } from "./pracWindowGroupHost.js";
import { registerPracTurnDiff } from "./pracTurnDiff.js";
import { ITimelineService } from "../../workbench/contrib/timeline/common/timeline.js";
import type { GroupRegionChannel } from "./pracWindowGroupHost.js";
import type { PracWindowGroup } from "./pracWindowGroup.js";
import { IMarkerService, MarkerSeverity } from "../../platform/markers/common/markers.js";
import type { IMarker } from "../../platform/markers/common/markers.js";
import {
  IWorkbenchLayoutService,
  IPartVisibilityChangeEvent,
  PanelAlignment,
  Parts,
  Position,
  positionToString,
} from "../services/layout/browser/layoutService.js";
import { Registry } from "../../platform/registry/common/platform.js";
import {
  IWorkbenchContributionsRegistry,
  Extensions as WorkbenchExtensions,
} from "../common/contributions.js";
import { EditorExtensions, EditorsOrder, IEditorFactoryRegistry } from "../common/editor.js";
import { EditorPaneDescriptor, IEditorPaneRegistry } from "./editor.js";
import { PracWindowInput } from "./pracWindowInput.js";
import { PracWindowPane } from "./pracWindowPane.js";
import { PracWindowProjection } from "./pracWindowProjection.js";
import { WorkbenchContextKeysHandler } from "./contextkeys.js";
import { setARIAContainer } from "../../base/browser/ui/aria/aria.js";
import { setHoverDelegateFactory } from "../../base/browser/ui/hover/hoverDelegateFactory.js";
import { setBaseLayerHoverDelegate } from "../../base/browser/ui/hover/hoverDelegate2.js";
// The embed bridge contract. `embedBridge.ts` is staged into this tree by this
// package's build (`vendor/vscode/scripts/build.mjs`) from
// `vendor/vscode/overlay/embedBridge.ts`, so both sides read one definition.
import {
  PART_HOST_ATTR,
  readEmbedBridge,
  type EmbedBridge,
  type PracVscodeAction,
  type PracVscodeActionModel,
  type ViewCatalogueEntry,
} from "./embedBridge.js";
import { IHoverService, WorkbenchHoverDelegate } from "../../platform/hover/browser/hover.js";
import { IMarkdownRendererService } from "../../platform/markdown/browser/markdownRenderer.js";
import { EditorMarkdownCodeBlockRenderer } from "../../editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js";
import "./style.js";

/** Options an embedder may pass to the workbench. */
export interface IEmbeddedWorkbenchOptions {
  /** Extra classes on the root container. */
  extraClasses?: string[];
  /**
   * The embedder's bridge, read where the construction options are still whole.
   *
   * It has to travel here rather than be read from `environmentService.options`
   * during service setup: that field is assigned in `initLayout`, which runs *after*
   * `initServices` — and the service registration (who owns the editor) has to be
   * decided inside `initServices`.
   */
  embedBridge?: EmbedBridge;
}

/**
 * The key one mounted surface is held under: the placement, not the file.
 *
 * `\u0000` cannot appear in a placement token or in a resource string, so the two
 * halves cannot be confused for one another however the resource is spelled.
 *
 * @param placement - the placement token.
 * @param resource - the file's URI, as a string.
 */
function placementKey(placement: string, resource: string): string {
  return `${placement}\u0000${resource}`;
}

/** The key one open editor is looked up under while placements are reconciled. */
function editorKey(resource: string, group: number): string {
  return `${resource}\u0000${group}`;
}

/** Hosts whose native context menu this workbench already suppresses (see `observeHost`). */
const suppressedContextMenus = new WeakSet<HTMLElement>();

/**
 * The workbench's context views (menus, quick pick) belong to the embedder's
 * overlay, not to the view that opened them.
 *
 * The default `ContextViewService` honours the container the caller passes; a
 * view title action passes its own shadow host, which puts the menu inside the
 * view's isolation root and clips it against the stack row. This override drops
 * that container: the service falls back to the layout's main container (the
 * float host mounted in the frame's overlay layer), which is where a popup
 * belongs.
 */
class PracContextViewService extends ContextViewService {
  override showContextView(delegate: IContextViewDelegate): IOpenContextView {
    return super.showContextView(delegate);
  }
}

/**
 * The default view service with one addition: views prac mounts outside a
 * `ViewPaneContainer` are still resolvable by id.
 *
 * `getViewWithId` is what container-scoped commands use (Explorer's Collapse
 * Folders is the first one); the stock implementation only looks in its private
 * container map, which prac deliberately does not populate because the frame,
 * not a VS Code part, owns the layout.
 */
class PracViewsService extends ViewsService {
  private readonly mountedViews = new Map<string, IView>();

  /** Make a mounted pane visible to `getViewWithId`. */
  registerMountedView(view: IView): void {
    this.mountedViews.set(view.id, view);
  }

  /** Forget a pane that was released or replaced. */
  unregisterMountedView(id: string): void {
    this.mountedViews.delete(id);
  }

  override getViewWithId<T extends IView>(id: string): T | null {
    return (this.mountedViews.get(id) as T | undefined) ?? super.getViewWithId<T>(id);
  }
}

export class EmbeddedWorkbench extends Disposable implements IWorkbenchLayoutService {
  declare readonly _serviceBrand: undefined;

  //#region Lifecycle

  private readonly _onWillShutdown = this._register(new Emitter<WillShutdownEvent>());
  readonly onWillShutdown = this._onWillShutdown.event;

  private readonly _onDidShutdown = this._register(new Emitter<void>());
  readonly onDidShutdown = this._onDidShutdown.event;

  //#endregion

  //#region Layout events

  private readonly _onDidChangeZenMode = this._register(new Emitter<boolean>());
  readonly onDidChangeZenMode = this._onDidChangeZenMode.event;

  private readonly _onDidChangeWindowMaximized = this._register(
    new Emitter<{ readonly windowId: number; readonly maximized: boolean }>(),
  );
  readonly onDidChangeWindowMaximized = this._onDidChangeWindowMaximized.event;

  private readonly _onDidChangeMainEditorCenteredLayout = this._register(new Emitter<boolean>());
  readonly onDidChangeMainEditorCenteredLayout = this._onDidChangeMainEditorCenteredLayout.event;

  private readonly _onDidChangePanelPosition = this._register(new Emitter<string>());
  readonly onDidChangePanelPosition = this._onDidChangePanelPosition.event;

  private readonly _onDidChangePanelAlignment = this._register(new Emitter<PanelAlignment>());
  readonly onDidChangePanelAlignment = this._onDidChangePanelAlignment.event;

  private readonly _onDidChangePartVisibility = this._register(
    new Emitter<IPartVisibilityChangeEvent>(),
  );
  readonly onDidChangePartVisibility = this._onDidChangePartVisibility.event;

  private readonly _onDidChangeNotificationsVisibility = this._register(new Emitter<boolean>());
  readonly onDidChangeNotificationsVisibility = this._onDidChangeNotificationsVisibility.event;

  private readonly _onDidChangeAuxiliaryBarMaximized = this._register(new Emitter<void>());
  readonly onDidChangeAuxiliaryBarMaximized = this._onDidChangeAuxiliaryBarMaximized.event;

  private readonly _onDidLayoutMainContainer = this._register(new Emitter<IDimension>());
  readonly onDidLayoutMainContainer = this._onDidLayoutMainContainer.event;

  private readonly _onDidLayoutContainer = this._register(
    new Emitter<{ readonly container: HTMLElement; readonly dimension: IDimension }>(),
  );
  readonly onDidLayoutContainer = this._onDidLayoutContainer.event;

  private readonly _onDidLayoutActiveContainer = this._register(new Emitter<IDimension>());
  readonly onDidLayoutActiveContainer = this._onDidLayoutActiveContainer.event;

  private readonly _onDidAddContainer = this._register(
    new Emitter<{ readonly container: HTMLElement; readonly disposables: DisposableStore }>(),
  );
  readonly onDidAddContainer = this._onDidAddContainer.event;

  private readonly _onDidChangeActiveContainer = this._register(new Emitter<void>());
  readonly onDidChangeActiveContainer = this._onDidChangeActiveContainer.event;

  //#endregion

  //#region Layout state

  readonly mainContainer = document.createElement("div");
  private readonly _mainContainerDimension = new Dimension(0, 0);
  get mainContainerDimension(): IDimension {
    return this._mainContainerDimension;
  }
  get activeContainerDimension(): IDimension {
    return this._mainContainerDimension;
  }
  get activeContainer(): HTMLElement {
    return this.mainContainer;
  }
  get containers(): Iterable<HTMLElement> {
    return [this.mainContainer];
  }
  readonly mainContainerOffset: ILayoutOffsetInfo = { top: 0, quickPickTop: 0 };
  readonly activeContainerOffset: ILayoutOffsetInfo = { top: 0, quickPickTop: 0 };
  readonly openedDefaultEditors = false;

  // The primary side bar and the panel have a *position* in the contract even
  // though the embedder decides placement itself. They are reported so the parts
  // that build class names from them (`createPartContainer`) and the parts that
  // read them for layout (`layoutService.getPanelPosition()` in the panel and
  // title bar) see a consistent answer; the setters are the honest no-op for a
  // composition this service does not own.

  private _sideBarPosition: Position = Position.LEFT;
  getSideBarPosition(): Position {
    return this._sideBarPosition;
  }

  private _panelPosition: Position = Position.BOTTOM;
  getPanelPosition(): Position {
    return this._panelPosition;
  }
  setPanelPosition(position: Position): void {
    if (this._panelPosition === position) return;
    this._panelPosition = position;
    this._onDidChangePanelPosition.fire(positionToString(position));
  }

  private _panelAlignment: PanelAlignment = "center";
  getPanelAlignment(): PanelAlignment {
    return this._panelAlignment;
  }
  setPanelAlignment(alignment: PanelAlignment): void {
    if (this._panelAlignment === alignment) return;
    this._panelAlignment = alignment;
    this._onDidChangePanelAlignment.fire(alignment);
  }

  private readonly parts = new Map<string, Part>();

  /** Views the embedder mounted, by view id — one pane each, created on demand. */
  /** Container title-menu actions, one per container, created lazily. */
  private readonly containerMenuActions = new Map<string, ViewContainerMenuActions>();
  /** The original actions behind the latest container action tree, for `run`. */
  private readonly containerActionRuns = new Map<string, Map<string, IAction>>();
  /** Action handlers per placement (`""` = the active group), for {@link runEditorAction}. */
  private readonly editorActionRuns = new Map<string, Map<string, IAction>>();
  /** The single write boundary for frame-owned window projections. */
  private windowProjection!: PracWindowProjection;

  private readonly mountedViews = new Map<
    string,
    { pane: ViewPane; host: HTMLElement; frame: HTMLElement }
  >();

  /**
   * View hosts whose view was not resolvable yet, by view id.
   *
   * A view can become resolvable *after* the composition hands its face over:
   * the explorer's own view registers later than the frame does (measured — the
   * same call succeeds seconds later), so a mount request is remembered and
   * retried instead of being dropped on the floor.
   */
  private readonly deferredViews = new Map<string, HTMLElement>();
  /** Retry rounds spent on {@link deferredViews} (bounded, see `scheduleViewRetry`). */
  private viewRetryRounds = 0;
  private readonly partHosts = new Map<string, HTMLElement>();
  /** Parts already created into a host container (never mounted twice). */
  private readonly mountedParts = new Set<string>();
  /** Host elements requested before their part registered (deferred mounting). */
  private readonly deferredHosts = new Map<string, HTMLElement>();
  /** Kept for runtime service access (`openWorkspaceFolder`). */
  private instantiationService: InstantiationService | undefined;
  /** The gate-only timeline provider's registration, so enabling twice is harmless. */
  private timelineProbe: { dispose(): void } | undefined;

  /**
   * Register the gate-only timeline provider (see the face's doc).
   *
   * This is not a product feature: prac's embed has no timeline source, and a Timeline pane
   * with nothing to show cannot be told apart from a broken one. The provider answers with one
   * deterministic entry per resource, labelled as a gate's.
   */
  private enableTimelineProbe(): void {
    const service = this.instantiationService;
    if (service === undefined || this.timelineProbe !== undefined) return;
    service.invokeFunction((accessor) => {
      const timeline = accessor.get(ITimelineService);
      this.timelineProbe = timeline.registerTimelineProvider({
        id: "prac-gate-timeline",
        label: "prac gate",
        scheme: "vscode-remote",
        dispose: () => {},
        provideTimeline: async (uri: URI) => ({
          source: "prac-gate-timeline",
          items: [
            {
              handle: `${uri.toString()}#prac-gate`,
              source: "prac-gate-timeline",
              id: "prac-gate-1",
              label: `prac gate entry for ${uri.path.split("/").pop() ?? uri.path}`,
              timestamp: Date.now() - 60_000,
            },
          ],
        }),
      });
    });
  }
  /**
   * The editing surface the embedder mounted, by **placement**.
   *
   * The key is `(group, resource)`, because that is what the embedder renders one view
   * for: the same file open in two groups is two surfaces, and the group is what tells
   * them apart. The value carries the group (whose element the surface lives in) and
   * the host element the embedder rendered (whose box the group is laid out in).
   */
  private readonly mountedFiles = new Map<
    string,
    {
      readonly placement: string;
      readonly resource: string;
      readonly group: PracWindowGroup;
      readonly element: HTMLElement;
    }
  >();
  /**
   * The live placements, by token: what the embedder quotes back when it mounts.
   *
   * A placement is a file in one group, and the **token** is its identity, not the
   * group: a placement moves between groups (the embedder moved its view, or the
   * workbench's own move command ran), and a consumer holding the token — a view id,
   * a tab record — must not be left with a stale one. So the token is minted once per
   * placement and only retargeted when the same file turns up in another group in the
   * same reconciliation (see {@link updatePlacements}).
   */
  private placements = new Map<string, { readonly resource: string; readonly group: number }>();
  /** The next placement token (never reused: a stale id must stay unknown). */
  private placementCount = 0;
  /**
   * Closes in flight, by {@link placementKey}.
   *
   * A mount that lands while *its* placement's file is being closed must not open it again —
   * the app has already decided that placement is gone. Keyed by placement rather than by
   * resource because the same file can stay open in another region.
   */
  private readonly closingFiles = new Set<string>();

  /**
   * Whether a resource is leaving the app entirely (every placement of it is mid-close).
   *
   * The activation path names only a resource, so it cannot ask about one placement; what it
   * must not do is put back a file the app has decided is gone. A *per-placement* close does
   * not qualify — the other region keeps its editor, so activating the file stays legitimate.
   *
   * @param resource - the app's URI for the file.
   * @returns true when the resource has placements and all of them are closing.
   */
  private isClosingEverywhere(resource: string): boolean {
    let placements = 0;
    for (const [placement, pair] of this.placements) {
      if (pair.resource !== resource) continue;
      placements += 1;
      if (!this.closingFiles.has(placementKey(placement, resource))) return false;
    }
    return placements > 0;
  }
  /** One single-view grid per mounted part; the grid supplies part positioning. */
  private readonly grids = new Map<string, Grid<ISerializableView>>();
  /**
   * Region hosts are sized from outside (the surrounding shell), and the
   * workbench's own layout passes never observe that. Without this, a part moved
   * into a host that is momentarily zero-width is laid out at zero and stays
   * blank — present in the DOM, invisible on screen.
   */
  private hostResizeObserver: ResizeObserver | undefined;
  private restored = false;
  private readonly _whenRestored = new Promise<void>((resolve) => {
    this.resolveRestored = resolve;
  });
  private resolveRestored!: () => void;
  get whenRestored(): Promise<void> {
    return this._whenRestored;
  }
  isRestored(): boolean {
    return this.restored;
  }

  //#endregion

  constructor(
    parent: HTMLElement,
    private readonly options: IEmbeddedWorkbenchOptions | undefined,
    private readonly serviceCollection: ServiceCollection,
    private readonly logService: ILogService,
  ) {
    super();
    this.mainContainer.classList.add("monaco-workbench");
    // Fill the root this side was handed (the embedder's float layer) instead of
    // being measured as a zero-sized box beside it: the app sizes every float it
    // places against its own container, so the container needs a box. Transparent
    // and click-through — the parts live in the embedder's regions, and only the
    // float containers opt back into pointer events (see {@link installStyles}).
    Object.assign(this.mainContainer.style, {
      position: "absolute",
      inset: "0",
      background: "transparent",
      pointerEvents: "none",
    });
    parent.appendChild(this.mainContainer);
    this.installStyles();
  }

  /**
   * The overlay's own stylesheet: which containers may take pointer events.
   *
   * The root is click-through so the embedder's frame stays usable, which means
   * every float has to opt back in. The list is a **list, not a wildcard**: these
   * are the containers this side creates for global surfaces (quick input, the
   * context-view container — menus — hover, notifications, and the modal block the
   * workbench's own dialogs live in: the save-on-close question is one, and without
   * it the dialog would be visible but not clickable). Anything
   * else the app puts in the root stays click-through, so a part that was never
   * given a host cannot quietly start swallowing the frame's clicks.
   */
  private installStyles(): void {
    const style = document.createElement("style");
    style.dataset.vscodeEmbed = "floats";
    style.textContent = `
.monaco-workbench > .quick-input-widget,
.monaco-workbench > .context-view,
.monaco-workbench > .monaco-hover,
.monaco-workbench > .notifications-toasts,
.monaco-workbench > .notifications-center,
.monaco-workbench > .monaco-dialog-modal-block { pointer-events: auto; }
`;
    mainWindow.document.head.appendChild(style);
  }

  //#region Startup

  startup(): IInstantiationService {
    try {
      const instantiationService = this.initServices(this.serviceCollection);
      this.instantiationService = instantiationService;

      instantiationService.invokeFunction((accessor) => {
        const lifecycleService = accessor.get(ILifecycleService);
        const hoverService = accessor.get(IHoverService);
        const markdownRendererService = accessor.get(IMarkdownRendererService);

        // Same pre-requisites as the classic workbench, minus its composition.
        markdownRendererService.setDefaultCodeBlockRenderer(
          instantiationService.createInstance(EditorMarkdownCodeBlockRenderer),
        );
        setHoverDelegateFactory((placement, enableInstantHover) =>
          instantiationService.createInstance(
            WorkbenchHoverDelegate,
            placement,
            { instantHover: enableInstantHover },
            {},
          ),
        );
        setBaseLayerHoverDelegate(hoverService);
        setARIAContainer(this.mainContainer);

        this.initLayout(accessor);

        Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).start(accessor);
        Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor);
        Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
          EditorPaneDescriptor.create(
            PracWindowPane,
            PracWindowPane.ID,
            "Prac Window",
          ),
          [new SyncDescriptor(PracWindowInput)],
        );

        this._register(instantiationService.createInstance(WorkbenchContextKeysHandler));
        this._register(
          lifecycleService.onWillShutdown((event) => this._onWillShutdown.fire(event)),
        );
        this._register(
          lifecycleService.onDidShutdown(() => {
            this._onDidShutdown.fire();
            this.dispose();
          }),
        );

        // Optional composition: either mount parts into hosts found in the document
        // now, or defer to the embedder's shell, which mounts each part into
        // its own region on demand. The shell hands its bridge over in the
        // construction options (`vscodeEmbed`), and that bridge is also how
        // this face gets back to it — see `embedBridge.ts`.
        const bridge = readEmbedBridge(this.environmentService?.options);
        if (bridge?.deferParts) {
          // No detached editor part: prac *is* the host (registered above), and the
          // embedder mounts each region's group where the region is.
          bridge.publish({
            mountViewInto: (viewId: string, element: HTMLElement) =>
              this.mountViewInto(viewId, element),
            focusView: (viewId: string) => this.focusView(viewId),
            releaseView: (viewId: string) => this.releaseView(viewId),
            listViews: () => this.listViews(),
            onDidChangeViews: (listener: () => void) => this.onDidChangeViews(listener),
            containerActions: (containerId: string) => this.containerActions(containerId),
            runAction: (containerId: string, actionId: string) =>
              this.runAction(containerId, actionId),
            editorActions: (placement?: string) => this.editorActions(placement),
            runEditorAction: (placement: string | undefined, actionId: string) =>
              this.runEditorAction(placement, actionId),
            mountFileInto: (placement: string, resource: string, element: HTMLElement) =>
              this.mountFileInto(placement, resource, element),
            focusFile: (placement: string, resource: string) => this.focusFile(placement, resource),
            releaseFile: (placement: string, resource: string) =>
              this.releaseFile(placement, resource),
            openFile: (resource: string) => this.openFile(resource),
            openPreviewFile: (resource: string) => this.openPreviewFile(resource),
            mapWindow: (id: string, title: string, region?: string) =>
              this.windowProjection.map(id, title, region),
            mappedWindows: () => this.windowProjection.mapped(),
            activeWindow: () => this.windowProjection.active(),
            activateWindow: (id: string) => this.windowProjection.activate(id),
            unmapWindow: (id: string) => this.windowProjection.unmap(id),
            orderWindow: (id: string, index: number) => this.windowProjection.order(id, index),
            orderFile: (resource: string, index: number) =>
              this.windowProjection.orderFile(resource, index),
            windowOrder: (region?: string) => this.windowProjection.windowOrder(region),
            projectionWriteAudit: () => this.windowProjection.audit(),
            editorModelWriteAudit: () => this.editorModelWriteAudit(),
            capabilities: {
              editors: this.createEditorsCapability(),
              diagnostics: this.createDiagnosticsCapability(),
            },
            /**
             * The app's region channel for `addGroup` (see `pracWindowGroupHost`'s
             * `setGroupRegionChannel`): prac's frame owns the region tree, so the workbench asks
             * the app to make the region a new group will live in.
             */
            setGroupRegionChannel: (channel: GroupRegionChannel) => setGroupRegionChannel(channel),
            /**
             * Gate-only: register a deterministic timeline provider through the workbench's
             * own `ITimelineService`, so a gate can assert the Timeline pane is upstream's
             * panel, driven by upstream's service, and that it follows the active file. The
             * embedder ships no timeline source of its own — this is a probe, and the entries
             * say so in their label.
             */
            enableTimelineProbe: () => this.enableTimelineProbe(),
            listPlacements: () => this.listPlacements(),
            onDidChangePlacements: (listener: () => void) => this.onDidChangePlacements(listener),
            listOpenFiles: () => this.listOpenFiles(),
            openUntitled: (path?: string) => this.openUntitled(path),
            openWorkspaceFolder: (folderUri: string) => this.openWorkspaceFolder(folderUri),
            workspaceInfo: () => this.workspaceInfo(),
          });
        } else {
          this.renderParts();
        }
        this.layout();

        this.restored = true;
        this.resolveRestored();
        lifecycleService.phase = LifecyclePhase.Restored;

        // Then `Eventually`, exactly as the shipped workbench does it (upstream
        // `workbench.ts:454-458`): after a short delay and when the window is idle.
        // Skipping this phase is not a cosmetic difference — every contribution
        // registered at `Eventually` never runs without it, and 77 of them are
        // registered there in this build (the document-symbols outline creator
        // among them, which is why the Outline used to answer "The active editor
        // cannot provide outline information" for a file it was showing).
        const eventuallyPhaseScheduler = this._register(
          new RunOnceScheduler(() => {
            this._register(
              runWhenWindowIdle(
                mainWindow,
                () => (lifecycleService.phase = LifecyclePhase.Eventually),
                2500,
              ),
            );
          }, 2500),
        );
        eventuallyPhaseScheduler.schedule();
      });

      return instantiationService;
    } catch (error) {
      onUnexpectedError(error);
      throw error;
    }
  }

  private initServices(serviceCollection: ServiceCollection): IInstantiationService {
    // This composition is the layout service.
    serviceCollection.set(IWorkbenchLayoutService, this);

    for (const [id, descriptor] of getSingletonServiceDescriptors()) {
      serviceCollection.set(id, descriptor);
    }

    // After the singleton list, so this is the context-view implementation the
    // workbench and every view sees. Its popups land in the float host, not in a
    // view's isolated shadow.
    serviceCollection.set(IContextViewService, new SyncDescriptor(PracContextViewService));
    // Views mounted by the embedder have no ViewPaneContainer, so make them
    // resolvable by id through the view service the container commands use.
    serviceCollection.set(IViewsService, new SyncDescriptor(PracViewsService));

    // prac's shell owns the editor: **prac is the editor host** (see
    // `pracWindowGroupHost.ts`), so the workbench's own editor parts manager is replaced
    // rather than created off-screen. Overriding after the singleton descriptors is
    // what makes the later registration win.
    //
    // The bridge is read from the **constructor** options, not from
    // `this.environmentService`: that field is only assigned in `initLayout`, which
    // runs after this method — reading it here silently skipped the override and left
    // the workbench's own parts manager in place (measured: `openFile` then failed in
    // `doFindGroup` with `activeGroup` undefined, because that manager's part is never
    // hosted any more).
    const embedBridge =
      this.options?.embedBridge ?? readEmbedBridge(this.environmentService?.options);
    if (embedBridge?.deferParts) {
      serviceCollection.set(IEditorGroupsService, new SyncDescriptor(PracWindowGroupHost));
    }

    const instantiationService = new InstantiationService(serviceCollection, true);
    instantiationService.invokeFunction((accessor) => {
      accessor.get(ILifecycleService).phase = LifecyclePhase.Ready;
    });

    // The embedder's turn-scoped diff command. It serves the two in-memory
    // sides through a read-only file system provider and a DiffEditorInput
    // subclass with a synthetic resource, so the diff is a normal prac
    // placement (tab, close, focus, chat move) instead of an invisible editor.
    this._register(registerPracTurnDiff(instantiationService));

    return instantiationService;
  }

  private initLayout(accessor: ServicesAccessorLike): void {
    // Touch the services that own parts so those parts construct and register here.
    this.environmentService = accessor.get(IBrowserWorkbenchEnvironmentService);
    this.themeService = accessor.get(IThemeService);
    this.hostService = accessor.get(IHostService);
    this.lifecycleService = accessor.get(ILifecycleService);
    this.storageService = accessor.get(IStorageService);
    this.configurationService = accessor.get(IConfigurationService);
    this.notificationService = accessor.get(INotificationService);
    this.workspaceContextService = accessor.get(IWorkspaceContextService);
    this.telemetryService = accessor.get(ITelemetryService);
    this.fileService = accessor.get(IFileService);

    // Parts live in these services.
    this.editorService = accessor.get(IEditorService);
    this.markerService = accessor.get(IMarkerService);
    this.untitledTextEditorService = accessor.get(IUntitledTextEditorService);
    this.editorGroupService = accessor.get(IEditorGroupsService);
    this.windowProjection = new PracWindowProjection(this.editorService, this.editorGroupService);
    this.paneCompositeService = accessor.get(IPaneCompositePartService);
    this.viewDescriptorService = accessor.get(IViewDescriptorService);
    this.titleService = accessor.get(ITitleService);
    this.statusBarService = accessor.get(IStatusbarService);
    this.bannerService = accessor.get(IBannerService);

    // Record externally-provided host containers before rendering.
    for (const partId of this.parts.keys()) {
      this.partHosts.set(partId, this.findPartHost(partId));
    }
  }

  private environmentService!: IBrowserWorkbenchEnvironmentService;
  private themeService!: IThemeService;
  private hostService!: IHostService;
  private lifecycleService!: ILifecycleService;
  private storageService!: IStorageService;
  private configurationService!: IConfigurationService;
  private notificationService!: INotificationService;
  private workspaceContextService!: IWorkspaceContextService;
  private telemetryService!: ITelemetryService;
  private fileService!: IFileService;
  private editorService!: IEditorService;
  private markerService!: IMarkerService;
  private untitledTextEditorService!: IUntitledTextEditorService;
  private editorGroupService!: IEditorGroupsService;
  private paneCompositeService!: IPaneCompositePartService;
  private viewDescriptorService!: IViewDescriptorService;
  private titleService!: ITitleService;
  private statusBarService!: IStatusbarService;
  private bannerService!: IBannerService;

  //#endregion

  //#region Parts

  registerPart(part: Part): IDisposable {
    const id = part.getId();
    this.parts.set(id, part);

    // A host may have been requested before the part existed: the shell can render
    // its regions before the workbench finishes starting.
    const deferred = this.deferredHosts.get(id);
    if (deferred) {
      this.deferredHosts.delete(id);
      this.mountPartInto(id, deferred);
    }

    return toDisposable(() => this.parts.delete(id));
  }

  /**
   * Create a registered view into an external host element (the embedder's shell).
   *
   * A view is created as its **own pane** — `ViewPane.render()` builds the header
   * and the body into the pane's own element — instead of through its view
   * container. The container is the workbench's grouping (activity bar, order,
   * drag and drop between views); the embedder supplies its own, so the pane is
   * what it gets. Mounting the same view again re-parents the pane it already
   * has rather than creating a second one — a view instance holds services.
   */
  focusView(viewId: string): void {
    const instantiationService = this.instantiationService;
    if (!instantiationService) return;
    instantiationService.invokeFunction((accessor) => {
      accessor.get(IViewsService).getViewWithId(viewId)?.focus();
    });
  }

  mountViewInto(viewId: string, element: HTMLElement): void {
    const mounted = this.mountedViews.get(viewId);
    if (mounted) {
      element.replaceChildren(mounted.frame);
      this.observeHost(element);
      mounted.host = element;
      this.layout();
      return;
    }
    if (this.tryMountView(viewId, element)) return;
    this.deferredViews.set(viewId, element);
    this.scheduleViewRetry();
  }

  /**
   * Create and mount a view, if it is resolvable.
   *
   * @param viewId - the view id.
   * @param element - the host element.
   * @returns whether the view was created.
   */
  private tryMountView(viewId: string, element: HTMLElement): boolean {
    const instantiationService = this.instantiationService;
    if (!instantiationService) {
      this.logService.error(`vscode-embed: cannot mount view ${viewId} before startup`);
      return false;
    }
    try {
      const descriptor = this.viewDescriptorService.getViewDescriptorById(viewId);
      // Not an error: the view may simply not have registered yet (deferred).
      if (!descriptor) return false;
      // Mirrors `ViewPaneContainer.createView`: the descriptor's ctor plus the
      // options its own container would pass it.
      const pane = instantiationService.createInstance(
        descriptor.ctorDescriptor.ctor as new (...args: unknown[]) => ViewPane,
        ...((descriptor.ctorDescriptor.staticArguments ?? []) as unknown[]),
        {
          id: descriptor.id,
          title: descriptor.name.value,
          expanded: true,
          singleViewPaneContainerTitle: descriptor.singleViewPaneContainerTitle,
        },
      );
      pane.render();
      // Tell the pane it is on screen: a tree view's *data* is provided by the
      // extension only once the view reports itself visible (this is how
      // `ViewPaneContainer` drives it too), so a view mounted outside a
      // container has to say so itself.
      pane.setVisible(true);
      // The pane goes inside the ancestor its own stylesheet requires. A
      // `ViewPaneContainer` nests every view in a `.monaco-pane-view`, and that
      // class is where the box model comes from — it defines
      // `--pane-header-size` and makes `.pane` a full-height flex column with a
      // flexible body (`base/browser/ui/splitview/paneview.css`). Mounting the
      // pane bare leaves `.pane-body` content-sized, which is invisible for a
      // view whose body is empty and just anchors something else (a webview).
      const frame = document.createElement("div");
      frame.className = "monaco-pane-view";
      frame.appendChild(pane.element);
      this.mountedViews.set(viewId, { pane, host: element, frame });
      this.instantiationService.invokeFunction((accessor) => {
        (accessor.get(IViewsService) as PracViewsService).registerMountedView(pane);
      });
      this._register(pane);
      element.replaceChildren(frame);
      // Size it like a container would (see `layout()`): a pane mounted outside
      // a container has no splitview to do it, and until it is sized it is a
      // header with a zero-height body.
      this.observeHost(element);
      this.layout();
      return true;
    } catch (error) {
      this.logService.error(`vscode-embed: failed to mount view ${viewId}`, error);
      return false;
    }
  }

  /**
   * Retry the deferred view hosts, a bounded number of rounds.
   *
   * Bounded on purpose: an genuinely unknown view id must end up in the log
   * rather than in a timer that runs for the life of the page.
   */
  private scheduleViewRetry(): void {
    if (this.viewRetryRounds >= 20) {
      this.logService.error(
        `vscode-embed: gave up mounting ${[...this.deferredViews.keys()].join(", ")}`,
      );
      this.deferredViews.clear();
      return;
    }
    this.viewRetryRounds += 1;
    const timer = setTimeout(() => {
      for (const [viewId, element] of [...this.deferredViews]) {
        if (this.tryMountView(viewId, element)) this.deferredViews.delete(viewId);
      }
      if (this.deferredViews.size === 0) this.viewRetryRounds = 0;
      else this.scheduleViewRetry();
    }, 250);
    this._register(toDisposable(() => clearTimeout(timer)));
  }

  /**
   * Dispose a view this composition mounted, so it can be created again.
   *
   * The pane is disposed (its registrations go with it); nothing else in the
   * view graph is torn down, so a second `mountViewInto` builds a fresh one.
   */
  releaseView(viewId: string): void {
    this.deferredViews.delete(viewId);
    const mounted = this.mountedViews.get(viewId);
    if (!mounted) return;
    this.mountedViews.delete(viewId);
    this.instantiationService.invokeFunction((accessor) => {
      (accessor.get(IViewsService) as PracViewsService).unregisterMountedView(viewId);
    });
    mounted.pane.setVisible(false);
    mounted.pane.dispose();
  }

  /**
   * The actions in one container's title menu.
   *
   * The menu is scoped to the container (`MenuId.ViewContainerTitle`), so it is
   * created once per container and cached; the embedder draws the container bar
   * and runs an action by id through the command service.
   *
   * @param containerId - the view container id.
   * @returns the container's primary and secondary actions.
   */
  containerActions(containerId: string): readonly PracVscodeAction[] {
    const container = this.viewDescriptorService.getViewContainerById(containerId);
    if (!container) return [];
    let menu = this.containerMenuActions.get(containerId);
    if (!menu) {
      const instantiationService = this.instantiationService;
      if (!instantiationService) return [];
      menu = this._register(
        instantiationService.createInstance(
          ViewContainerMenuActions,
          this.mainContainer,
          container,
          undefined,
        ),
      );
      this.containerMenuActions.set(containerId, menu);
    }
    const runs = new Map<string, IAction>();
    const toAction = (action: IAction): PracVscodeAction => {
      runs.set(action.id, action);
      const submenu =
        action instanceof SubmenuAction
          ? action.actions.map((child) => toAction(child))
          : undefined;
      return {
        id: action.id,
        label: action.label,
        icon: typeof action.class === "string" ? action.class : undefined,
        enabled: action.enabled,
        checked: action.checked,
        tooltip: action.tooltip,
        ...(submenu === undefined ? {} : { submenu }),
      };
    };
    const actions = [...menu.getPrimaryActions(), ...menu.getSecondaryActions()].map(toAction);
    this.containerActionRuns.set(containerId, runs);
    return actions;
  }

  /**
   * Run one container-title action by id, through its original `IAction`.
   *
   * @param containerId - the container id.
   * @param actionId - the action id from {@link EmbeddedWorkbench.containerActions}.
   */
  runAction(containerId: string, actionId: string): void {
    const action = this.containerActionRuns.get(containerId)?.get(actionId);
    if (action === undefined) return;
    void action.run();
  }

  /**
   * The active editor window's title actions.
   *
   * The menu is scoped to the active group's active editor; the embedder renders
   * the returned model in prac's tab strip rather than in the group header.
   *
   * @returns primary and secondary actions for the active window.
   */
  editorActions(placement?: string): PracVscodeActionModel {
    const groupId = placement === undefined ? undefined : this.placements.get(placement)?.group;
    const group =
      groupId === undefined
        ? (this.editorGroupService.activeGroup as PracWindowGroup | undefined)
        : (this.editorGroupService.getGroup(groupId) as PracWindowGroup | undefined);
    if (group === undefined) return { primary: [], secondary: [] };
    const store = new DisposableStore();
    try {
      const { actions } = group.createEditorActions(store);
      const runs = new Map<string, IAction>();
      const toAction = (action: IAction): PracVscodeAction => {
        runs.set(action.id, action);
        const submenu =
          action instanceof SubmenuAction
            ? action.actions.map((child) => toAction(child))
            : undefined;
        return {
          id: action.id,
          label: action.label,
          icon: typeof action.class === "string" ? action.class : undefined,
          enabled: action.enabled,
          checked: action.checked,
          tooltip: action.tooltip,
          ...(submenu === undefined ? {} : { submenu }),
        };
      };
      const primary = actions.primary.map(toAction);
      const secondary = actions.secondary.map(toAction);
      // Copy **after** mapping: `toAction` is what fills `runs`, and the return
      // used to map after the copy — the model showed actions whose handlers
      // were never in the run map (clicked, nothing happened).
      this.editorActionRuns.set(placement ?? "", runs);
      return { primary, secondary };
    } finally {
      store.dispose();
    }
  }

  /**
   * Run one editor-title action by id.
   *
   * @param actionId - the action id from {@link editorActions}.
   */
  runEditorAction(placement: string | undefined, actionId: string): void {
    const action = this.editorActionRuns.get(placement ?? "")?.get(actionId);
    if (action === undefined) return;
    void action.run();
  }

  //#region View catalogue

  /** Listeners waiting on catalogue changes. */
  private readonly viewCatalogueListeners = new Set<() => void>();
  /** One active-descriptor subscription per container, keyed by container id. */
  private readonly viewCatalogueSubscriptions = new Map<string, IDisposable>();
  /** Whether the container-wide subscription has been installed. */
  private viewCatalogueObserving = false;

  /**
   * The views the workbench currently offers, across every container.
   *
   * Reports the **active** descriptors — the ones whose `when` holds right now —
   * because that is the layer the workbench itself uses to decide what a
   * container offers. The `visible` layer is deliberately not reported: it folds
   * in the workbench's own per-view show/hide state, and the embedder decides
   * what is on screen, so reporting both would make two authorities for one
   * question.
   *
   * @returns one entry per active view.
   */
  listViews(): ViewCatalogueEntry[] {
    const entries: ViewCatalogueEntry[] = [];
    for (const container of this.viewDescriptorService.viewContainers) {
      const location = this.viewDescriptorService.getViewContainerLocation(container);
      const model = this.viewDescriptorService.getViewContainerModel(container);
      for (const descriptor of model.activeViewDescriptors) {
        entries.push({
          id: descriptor.id,
          title: descriptor.name.value,
          containerId: container.id,
          containerTitle:
            typeof container.title === "string" ? container.title : container.title.value,
          location: location === null ? "sidebar" : ViewContainerLocationToString(location),
        });
      }
    }
    return entries;
  }

  /** Subscribe to catalogue changes (see {@link WorkbenchFace.onDidChangeViews}). */
  onDidChangeViews(listener: () => void): () => void {
    this.viewCatalogueListeners.add(listener);
    this.observeViewCatalogue();
    return toDisposable(() => this.viewCatalogueListeners.delete(listener));
  }

  /**
   * Keep the catalogue observe-able as containers come and go.
   *
   * The container-wide event covers registration and deregistration; each
   * container model's active-descriptor event covers `when` flipping, which is
   * the common case (context keys change as the user works).
   */
  private observeViewCatalogue(): void {
    if (!this.viewCatalogueObserving) {
      this.viewCatalogueObserving = true;
      this._register(
        this.viewDescriptorService.onDidChangeViewContainers(() => {
          this.subscribeViewCatalogueContainers();
          this.fireViewCatalogue();
        }),
      );
    }
    this.subscribeViewCatalogueContainers();
  }

  private subscribeViewCatalogueContainers(): void {
    const containers = this.viewDescriptorService.viewContainers;
    const live = new Set(containers.map((container) => container.id));
    for (const [id, subscription] of [...this.viewCatalogueSubscriptions]) {
      if (live.has(id)) continue;
      subscription.dispose();
      this.viewCatalogueSubscriptions.delete(id);
    }
    for (const container of containers) {
      if (this.viewCatalogueSubscriptions.has(container.id)) continue;
      const model = this.viewDescriptorService.getViewContainerModel(container);
      this.viewCatalogueSubscriptions.set(
        container.id,
        model.onDidChangeActiveViewDescriptors(() => this.fireViewCatalogue()),
      );
    }
  }

  private fireViewCatalogue(): void {
    for (const listener of [...this.viewCatalogueListeners]) listener();
  }

  //#endregion

  /**
   * Mount one **placement's** editing surface into the element prac prepared for it.
   *
   * The unit is the placement, and {@link FilePlacement.placement} is what the embedder
   * names. That is what lets one file live in two regions: each placement gets its own
   * host element, and each element is filled by *its* editor, so the two surfaces are
   * two editors of one model rather than one editor fighting for two boxes.
   *
   * The element's region is where the placement is *shown*, so a mount that arrives in
   * another region is a **move**: the editor travels (or the whole group does, when the
   * file is alone in it), and the placement keeps its token. Measured the other way —
   * a view id carrying the group, with every move opening the editor in the
   * destination's group — one move changed the file's name, and every consumer holding
   * it (the tab, the recall row, the gate) was left with a stale one.
   *
   * The surface a person sees is the pane the workbench's editor service knows about
   * — its language features, markers, view state, commands, breadcrumbs and peek
   * included — instead of a look-alike widget beside an off-screen pane.
   *
   * The resource may arrive as a full URI string (`vscode-remote://…`, which is what
   * the app's own workspace folders look like) or as a bare path; the embedder cannot
   * construct a `URI` instance, so the string is parsed here — the same reason
   * `openWorkspaceFolder` takes a string.
   *
   * @param placement - the placement token.
   * @param resource - the file's URI, as a string.
   * @param element - the element the embedder rendered for the file's view.
   */
  mountFileInto(placement: string, resource: string, element: HTMLElement): void {
    const instantiationService = this.instantiationService;
    if (!instantiationService) {
      this.logService.error(`vscode-embed: cannot mount file ${resource} before startup`);
      return;
    }
    const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
      ? URI.parse(resource)
      : URI.file(resource);
    void instantiationService
      .invokeFunction(async (accessor) => {
        const host = accessor.get(IEditorGroupsService) as unknown as PracWindowGroupHost;
        const resolver = accessor.get(IEditorResolverService);
        // The region is read from the DOM the frame rendered ("the adaptor recognises
        // its root from elements"): the view host sits inside its region. A host with
        // no region ancestor (a probe mounting a file straight into an element) is a
        // region of its own — one host, one group — so two hosts never fight over the
        // same group element.
        const region = this.regionOf(element) ?? this.hostRegion(element);
        const group = this.groupForMount(host, placement, uri, region);
        group.create(element);
        // The file the **group already holds** is the editor to show: the app
        // reaches the workbench through `IEditorService.openEditor`, which builds
        // its own input, and resolving a second one for the same resource puts two
        // inputs for one file in the group's model — measured as a doubled entry in
        // the `editors` capability and two tabs for one file. So the group's own
        // editor wins, and only a file it does not hold is resolved fresh.
        const held = group.findEditors(uri)[0];
        const shown = group.activeEditor;
        if (shown?.resource?.toString() === uri.toString()) {
          // The group already shows this file, so mounting is the group's element
          // moving into the host the frame rendered — not an open. Opening again would
          // be redundant work on every re-render of the frame's view list.
          host.activateGroup(group.id);
          this.mountedFiles.set(placementKey(placement, resource), {
            placement,
            resource,
            group,
            element,
          });
          this.layoutGroup(group, element);
          this.observeHost(element);
          return;
        }
        const editor =
          held ??
          (
            (await resolver.resolveEditor({ resource: uri })) as {
              editor?: EditorInput;
            }
          ).editor;
        if (!editor) throw new Error(`no editor for ${resource}`);
        // Re-checked here rather than at entry: resolving the editor is asynchronous,
        // and a close can land while it is in flight.
        if (this.closingFiles.has(placementKey(placement, resource))) return;
        await group.openEditor(editor, { pinned: true, preserveFocus: true });
        host.activateGroup(group.id);
        this.mountedFiles.set(placementKey(placement, resource), {
          placement,
          resource,
          group,
          element,
        });
        this.layoutGroup(group, element);
        this.observeHost(element);
      })
      .catch((error) => {
        this.logService.error(`vscode-embed: failed to mount file ${resource}`, error);
      });
  }

  /**
   * The group a placement's surface belongs in, when the frame renders it in a region.
   *
   * Three cases, and they are the whole of "where does a file live":
   *
   * 1. the placement's group is *already* shown here — a tab switch, or a re-render of
   *    the frame's view list: nothing moves, the group's element is re-parented into
   *    the host the frame rendered (that is what `create` does);
   * 2. the placement's group holds **only this file** and the region has no group yet:
   *    the group itself moves (one group, one file, one region — nothing else can be
   *    disturbed, and the editor keeps its pane);
   * 3. otherwise the region has a group of its own (or this file shares its group with
   *    others), so the *editor* moves — upstream's `moveEditor`, open in the target and
   *    close in the source — and the views left behind keep their surfaces. The
   *    placement is retargeted to the new group on the next
   *    {@link updatePlacements}, so its token (and the embedder's view id) is
   *    unchanged either way.
   *
   * @param host - prac's editor host.
   * @param placement - the placement token.
   * @param uri - the file's URI.
   * @param region - the region the frame rendered this placement in.
   */
  private groupForMount(
    host: PracWindowGroupHost,
    placement: string,
    uri: URI,
    region: string,
  ): PracWindowGroup {
    const record = this.updatePlacements().get(placement);
    const named = record === undefined ? undefined : host.groupById(record.group);
    if (named === undefined) {
      // A placement the workbench does not know (a probe, or a view persisted from a
      // page whose editors are gone): the region's own group, made if needed.
      return host.ensureGroup(region, region);
    }
    if (host.regionOf(named) === region) return named;
    const resident = host.groupForRegion(region);
    if (named.count === 1 && named.findEditors(uri).length === 1 && resident === undefined) {
      host.rehomeGroup(named, region);
      return named;
    }
    const target = resident ?? host.ensureGroup(region, region);
    const editor = named.findEditors(uri)[0];
    if (editor !== undefined) {
      // The editor's home moves; the source group keeps whatever else it holds.
      named.moveEditor(editor, target, { pinned: true, preserveFocus: true });
      this.updatePlacements();
      const left = host.regionOf(named);
      if (named.isEmpty && left !== undefined) host.removeGroupByRegion(left);
    }
    return target;
  }

  /**
   * Forget one placement's surface.
   *
   * The **editor stays open**: it is still open in the workbench, and the file view
   * may come back (switching tabs, moving the view). Only the embedder's bookkeeping
   * goes; the group keeps the pane.
   *
   * @param placement - the placement token.
   * @param resource - the file's resource string.
   */
  releaseFile(placement: string, resource: string): void {
    this.mountedFiles.delete(placementKey(placement, resource));
  }

  /** Region ids handed to hosts that carry no `[data-prac-region]` ancestor. */
  private readonly adhocRegions = new WeakMap<HTMLElement, string>();
  private adhocRegionCount = 0;

  /**
   * The prac region a host element sits in, or `undefined` for a bare host.
   *
   * The frame renders every view inside **its own shadow root** (the frame owns the
   * isolation boundary), so the host's region ancestor is across a shadow boundary and
   * `element.closest` cannot see it. Walking out through the roots is what makes the
   * region the group's identity: without it every mount looked like a host of its own,
   * so every view — and every tab click — created a **new group**, and one file ended
   * up as several editors in one session (measured: groups 0,1,2,3,4,5,6 for six
   * mounts, and a close that left the file open).
   *
   * @param element - the element the embedder rendered for a file's view.
   * @returns the region id, or `undefined` when no ancestor carries one.
   */
  private regionOf(element: HTMLElement): string | undefined {
    let node: Element | null = element;
    while (node !== null) {
      const region = node.closest("[data-prac-region]");
      if (region !== null) return region.getAttribute("data-prac-region") ?? undefined;
      const root: Node = node.getRootNode();
      node = root instanceof ShadowRoot ? (root.host as Element) : null;
    }
    return undefined;
  }

  /**
   * The region id for a host element that is not inside a region.
   *
   * @param element - the host element.
   * @returns a stable id for that element.
   */
  private hostRegion(element: HTMLElement): string {
    const existing = this.adhocRegions.get(element);
    if (existing !== undefined) return existing;
    const created = `host:${this.adhocRegionCount++}`;
    this.adhocRegions.set(element, created);
    return created;
  }

  /**
   * Lay one group out in the box of the element showing it.
   *
   * @param group - the group.
   * @param element - the element the group is shown in.
   */
  private layoutGroup(group: PracWindowGroup, element: HTMLElement): void {
    const box = element.getBoundingClientRect();
    group.layout(Math.round(box.width), Math.round(box.height), 0, 0);
  }

  /**
   * Make one placement's file the app's active editor.
   *
   * The embedder calls this when its view for the placement takes focus. The workbench
   * follows *its* active editor — the Outline, the Timeline and every command read it
   * — and the embedder is the only side that knows which region a person is working
   * in, so focus has to travel up. The group is named rather than searched for: the
   * same file can sit in two groups, and only the embedder knows which of them the
   * person is in.
   *
   * @param placement - the placement token.
   * @param resource - the file's resource string, as {@link mountFileInto} took it.
   */
  focusFile(placement: string, resource: string): void {
    // A focus event the mechanism caused itself is not the person choosing a region:
    // opening an editor focuses its pane, and reading that as "work here" is what made
    // this fight the client's activate reconciliation forever (see `noteSelfFocus`).
    if ((this.editorGroupService as unknown as { isSelfFocus?: () => boolean }).isSelfFocus?.()) {
      return;
    }
    try {
      const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
        ? URI.parse(resource)
        : URI.file(resource);
      // The named placement's group when it is ours, otherwise whichever holds the
      // file: the same file can sit in two groups, and only the embedder knows which
      // of them the person is in.
      const named = (this.editorGroupService as unknown as PracWindowGroupHost).groupById(
        this.updatePlacements().get(placement)?.group ?? -1,
      );
      const groups =
        named === undefined
          ? this.editorGroupService.groups
          : [named, ...this.editorGroupService.groups.filter((group) => group !== named)];
      for (const group of groups) {
        const editor = group.findEditors(uri)[0];
        if (editor === undefined) continue;
        // A group shows whichever of its files was **last activated**, and the event that
        // arrived here may be the focus that activation raised (opening an editor focuses
        // its pane) while the frame still shows the previous view's host element — the
        // focus then bubbles out of *that* element, so it is attributed to the placement
        // the frame was showing, not the one it is switching to. Measured on a reopen:
        // the file that took the centre was activated, its pane focus was read as
        // "the person works in the old region", the app was dragged back to the file that
        // had just given up the centre, and the new file's view ended up with no surface.
        // An event only speaks for a placement whose file is what the group is showing.
        const shown = group.activeEditor?.resource?.toString();
        if (shown !== undefined && shown !== uri.toString()) return;
        this.editorGroupService.activateGroup(group);
        // The group already shows this editor: focus travelling up must not re-open
        // what is already open (a mount/re-parent is not an open).
        if (shown === uri.toString()) return;
        void group.openEditor(editor, { preserveFocus: true });
        return;
      }
    } catch (error) {
      this.logService.error(`vscode-embed: failed to focus file ${resource}`, error);
    }
  }

  /**
   * Open a file in the workbench, by the same string vocabulary as
   * {@link mountFileInto}.
   *
   * The public `vscode.open` command cannot be driven from the embedder (its
   * argument is validated against a `URI` instance the page cannot construct), so
   * opening by path goes through here. The editor service opens it like any other
   * editor — which is also how the embedder hears about it
   * ({@link listOpenFiles}) and turns it into a view.
   *
   * @param resource - the file's URI, as a string.
   */
  /** Aggregate editor-model writes across the groups (diagnostics). */
  editorModelWriteAudit(): Readonly<{
    open: number;
    close: number;
    move: number;
    active: number;
    pin: number;
    other: number;
    projectionMove: number;
    externalMove: number;
    projectionActive: number;
    externalActive: number;
  }> {
    const total = {
      open: 0,
      close: 0,
      move: 0,
      active: 0,
      pin: 0,
      other: 0,
      projectionMove: 0,
      externalMove: 0,
      projectionActive: 0,
      externalActive: 0,
    };
    for (const group of this.editorGroupService.groups) {
      const writes = (group as unknown as PracWindowGroup).modelWriteAudit();
      total.open += writes.open;
      total.close += writes.close;
      total.move += writes.move;
      total.active += writes.active;
      total.pin += writes.pin;
      total.other += writes.other;
      total.projectionMove += writes.projectionMove;
      total.externalMove += writes.externalMove;
      total.projectionActive += writes.projectionActive;
      total.externalActive += writes.externalActive;
    }
    return total;
  }

  /**
   * Open a file as a preview editor. Gate-only: the app's own open is pinned
   * (decision 17), but the workbench's Explorer single-click path is preview,
   * and this is how a gate can exercise that state.
   *
   * @param resource - the file URI.
   */
  openPreviewFile(resource: string): void {
    try {
      const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource) ? URI.parse(resource) : URI.file(resource);
      void this.fileService
        .canHandleResource(uri)
        .then(() => this.editorService.openEditor({ resource: uri, options: { pinned: false } }))
        .catch((error) => this.logService.error(`vscode-embed: preview open failed for ${resource}`, error));
    } catch (error) {
      this.logService.error(`vscode-embed: preview open failed for ${resource}`, error);
    }
  }

  openFile(resource: string): void {
    try {
      const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
        ? URI.parse(resource)
        : URI.file(resource);
      // Activate the scheme's file system provider *before* opening: the editor
      // service picks a `FileEditorInput` only when the scheme already has a
      // provider, and this composition's provider (the remote one) registers
      // asynchronously. Opening first built a `TextResourceEditorInput`, whose
      // `resolve` rejects the model `createModelReference` returns — measured as
      // `Unexpected model for TextResourceEditorInput: …` on a fresh page, while
      // the same open after any read succeeded.
      void this.fileService
        .canHandleResource(uri)
        // `pinned: true` is prac's decision, not upstream's default: the app's open set
        // **is** prac's tab set (decision 17), so a file the app opened is a permanent
        // tab rather than VS Code's italic preview that the next single click replaces
        // (measured on the rig: the capability never reports `preview` for an app-opened
        // file). Editors the *workbench* opens — a command, an extension — follow
        // upstream's derivation, `enablePreview` included, in `PracWindowGroup.openEditor`.
        .then(() => this.editorService.openEditor({ resource: uri, options: { pinned: true } }))
        .catch((error) => {
          this.logService.error(`vscode-embed: openFile failed for ${resource}`, error);
        });
    } catch (error) {
      this.logService.error(`vscode-embed: openFile failed for ${resource}`, error);
    }
  }

  /**
   * The resources the workbench has open.
   *
   * Read from the editor service rather than kept as a list of our own: the
   * app's own UI (explorer clicks, commands, go-to-definition) opens editors
   * through it. An editor input without a resource is not a file the embedder
   * can render as one, so it is left out.
   *
   * @returns one URI string per open file, in the workbench's order.
   */
  listOpenFiles(): string[] {
    const instantiationService = this.instantiationService;
    if (!instantiationService) return [];
    try {
      return instantiationService.invokeFunction((accessor) => {
        // Only what the embedder can actually render as a *file*: an editor
        // input can carry a resource and still not be one — the getting-started
        // page (`walkThrough:`) has no text model, and an untitled buffer
        // (`untitled:`) has a model but no file system provider, so reading it
        // as a file fails (`createModelReference` goes through the file
        // service). The provider test is what both of those fail.
        const files = accessor.get(IFileService);
        // One entry per *file*, not per open editor: a file can sit in more than
        // one group (the embedder gives each mounted file a group of its own), and
        // the embedder's catalogue is keyed by the file.
        const seen = new Set<string>();
        return this.editorService.editors
          .map((editor) => editor.resource)
          .filter((resource): resource is URI => resource !== undefined)
          .filter((resource) => files.hasProvider(resource))
          .map((resource) => resource.toString())
          .filter((resource) => (seen.has(resource) ? false : (seen.add(resource), true)));
      });
    } catch (error) {
      this.logService.error("vscode-embed: failed to list open files", error);
      return [];
    }
  }

  /**
   * The file-capable editors the workbench holds, as `(resource, group)` pairs.
   *
   * Only what the embedder can actually render as a *file*: an editor input can carry a
   * resource and still not be one — the getting-started page (`walkThrough:`) has no
   * text model, and an untitled buffer (`untitled:`) has a model but no file system
   * provider, so reading it as a file fails (`createModelReference` goes through the
   * file service). The provider test is what both of those fail.
   *
   * @returns one pair per open editor, in the workbench's order.
   */
  private openEditors(): { resource: string; group: number }[] {
    if (!this.instantiationService) return [];
    try {
      return this.editorService
        .getEditors(EditorsOrder.SEQUENTIAL)
        .filter(
          ({ editor }) =>
            editor.resource !== undefined && this.fileService.hasProvider(editor.resource),
        )
        .map(({ editor, groupId }) => ({
          resource: editor.resource?.toString() ?? "",
          group: groupId,
        }));
    } catch (error) {
      this.logService.error("vscode-embed: failed to read the open editors", error);
      return [];
    }
  }

  /**
   * Reconcile the placement tokens against the editors that are open right now.
   *
   * The token is the placement's identity, so the one thing this must never do is mint a
   * new one for a placement that merely **moved**: a view whose editor went to another
   * group is the same placement, and every consumer's view id, tab record and recall row
   * quotes the token. So the pass is:
   *
   * 1. a `(resource, group)` pair that still exists keeps its token — the common case;
   * 2. an open pair with no token of its own **adopts** the token of a placement of the
   *    same file that is gone — that is a move (the embedder moved the view, or the
   *    workbench's own move ran), and the two are one placement;
   * 3. anything left is genuinely new (a file just opened, or a split: the same file in
   *    a second group) and gets a fresh token.
   *
   * Called before every read and after every mount that moves an editor, so it is
   * idempotent and cheap: the pair set is the editor service's own.
   *
   * @returns the live placements by token.
   */
  private updatePlacements(): Map<string, { readonly resource: string; readonly group: number }> {
    const open = this.openEditors();
    const openKeys = new Set(open.map(({ resource, group }) => editorKey(resource, group)));
    const next = new Map<string, { readonly resource: string; readonly group: number }>();
    const surviving = new Set<string>();
    for (const [token, value] of this.placements) {
      if (!openKeys.has(editorKey(value.resource, value.group))) continue;
      next.set(token, value);
      surviving.add(token);
    }
    const claimed = new Set(next.values().map(({ resource, group }) => editorKey(resource, group)));
    const adopted = new Set<string>();
    for (const pair of open) {
      const key = editorKey(pair.resource, pair.group);
      if (claimed.has(key)) continue;
      const moved = [...this.placements].find(
        ([token, value]) =>
          value.resource === pair.resource && !surviving.has(token) && !adopted.has(token),
      );
      if (moved === undefined) {
        next.set(`p${this.placementCount++}`, pair);
      } else {
        next.set(moved[0], pair);
        adopted.add(moved[0]);
      }
      claimed.add(key);
    }
    this.placements = next;
    return next;
  }

  /** The token of one `(resource, group)` pair, by pair key. */
  private placementTokens(): Map<string, string> {
    const tokens = new Map<string, string>();
    for (const [token, value] of this.updatePlacements()) {
      tokens.set(editorKey(value.resource, value.group), token);
    }
    return tokens;
  }

  /**
   * The file **placements** the workbench has open: one entry per file-in-a-group.
   *
   * The same file open in two groups is two entries — that is what the embedder needs to
   * give each of them its own view. {@link FilePlacement.placement} is the entry's
   * identity and {@link FilePlacement.region} is where the embedder is showing it, so a
   * consumer can place a view without knowing anything about editor groups.
   *
   * @returns one entry per file-in-a-group, in the workbench's order.
   */
  listPlacements(): {
    placement: string;
    resource: string;
    group: number;
    region: string | null;
  }[] {
    if (!this.instantiationService) return [];
    try {
      const tokens = this.placementTokens();
      return this.openEditors().map(({ resource, group: groupId }) => {
        const group = this.editorGroupService.getGroup(groupId) as PracWindowGroup | undefined;
        return {
          placement: tokens.get(editorKey(resource, groupId)) ?? "",
          resource,
          group: groupId,
          region:
            (group === undefined ? undefined : this.editorGroupService.regionOf(group)) ?? null,
        };
      });
    } catch (error) {
      this.logService.error("vscode-embed: failed to list file placements", error);
      return [];
    }
  }

  /**
   * Subscribe to changes in the placement set.
   *
   * Two of the editor service's events can mean "the set changed" (activate, close) and
   * neither *is* the set, so the set is compared here: the listener hears exactly when
   * the set it would read differs from the one it last saw. The comparison is over the
   * **placements** — the token, plus the resource, group and region each one names — so
   * moving an editor from one group to another reads as a change (the view has to
   * follow) while activating, editing or dirtying a file does not. Reporting those would
   * put the embedder's arrangement on the editor's change stream: measured, a catalogue
   * wired that way re-synced ~300 000 times a second and took the page down.
   *
   * @param listener - called when the placement set changed.
   * @returns a function that unsubscribes.
   */
  onDidChangePlacements(listener: () => void): () => void {
    const snapshot = (): string =>
      this.listPlacements()
        .map(
          ({ placement, resource, group, region }) =>
            `${placement}\u0000${resource}\u0000${group}\u0000${region ?? ""}`,
        )
        .join("\n");
    let last = snapshot();
    const notify = (): void => {
      const next = snapshot();
      if (next === last) return;
      last = next;
      listener();
    };
    const store = new DisposableStore();
    store.add(this.editorService.onDidActiveEditorChange(notify));
    store.add(this.editorService.onDidCloseEditor(notify));
    store.add(this.editorService.onDidEditorsChange(notify));
    return () => store.dispose();
  }

  /**
   * The editor set as a capability: the same handle the UI renders and the agent
   * reads.
   *
   * Data is the editor service's own (open editors, the active one, each input's
   * dirty state) plus the groups' preview editors — nothing is derived or
   * cached, so there is no second truth to drift.
   *
   * @returns the capability.
   */
  private createEditorsCapability(): {
    snapshot: () => {
      resource: string;
      active: boolean;
      dirty: boolean;
      preview: boolean;
      placement: string;
      group: number;
      region: string | null;
    }[];
    subscribe: (listener: () => void) => () => void;
    settled: () => Promise<void>;
    version: () => number;
    actions: {
      activate: (resource: string) => void;
      close: (placement: string, resource: string) => void;
      reorder: (placement: string, resource: string, index: number) => void;
    };
  } {
    let revision = 0;
    const listeners = new Set<() => void>();
    const dirtyListeners = new DisposableStore();
    const notify = (): void => {
      revision += 1;
      // Rebinding per-input dirty listeners here keeps one subscription path: a
      // dirty change is an editors change, and the set of inputs to watch is the
      // set the last notification was about.
      this.watchDirty(dirtyListeners, notify);
      for (const listener of [...listeners]) listener();
    };
    const entryOf = (
      editor: EditorInput,
      groupId: GroupIdentifier,
      previews: ReadonlySet<string>,
      tokens: ReadonlyMap<string, string>,
    ) => {
      const group = this.editorGroupService.getGroup(groupId) as PracWindowGroup | undefined;
      const resource = editor.resource?.toString() ?? "";
      return {
        resource,
        active: editor === this.editorService.activeEditor,
        dirty: editor.isDirty(),
        // **Per group**: a file can be a temporary editor in one group and a pinned one in
        // another — that is exactly what "Open to the Side" makes — and the flat set this used
        // to be made both read as temporary (measured: `region-2: preview=true` after the
        // command, which is what a person reported as "临时打开时 Open to the Side 不好").
        preview: previews.has(editorKey(resource, groupId)),
        // The placement this entry is, and the group and region it currently sits in: a
        // file open in two groups is two entries, and a consumer gives each of them its
        // own view. `getEditors` is what pairs the editor with its group — the flat
        // `editors` list does not say where each one lives.
        placement: tokens.get(editorKey(resource, groupId)) ?? "",
        group: groupId,
        region: (group === undefined ? undefined : this.editorGroupService.regionOf(group)) ?? null,
      };
    };
    /** One entry per (group, editor): the same file in two regions is two of these. */
    const visibleEditors = (): { editor: EditorInput; groupId: GroupIdentifier }[] =>
      this.editorService
        .getEditors(EditorsOrder.SEQUENTIAL)
        .filter(
          ({ editor }) =>
            editor.resource !== undefined && this.fileService.hasProvider(editor.resource),
        )
        .map(({ editor, groupId }) => ({ editor, groupId }));
    /** Each group's temporary editor, keyed by group: preview is a per-(group, editor) fact. */
    const previewsOf = (): Set<string> => {
      const previews = new Set<string>();
      for (const group of this.editorGroupService.groups) {
        const preview = group.previewEditor;
        if (preview) previews.add(editorKey(preview.resource?.toString() ?? "", group.id));
      }
      return previews;
    };
    this._register(this.editorService.onDidEditorsChange(() => notify()));
    this.watchDirty(dirtyListeners, notify);
    return {
      snapshot: () => {
        const previews = previewsOf();
        const tokens = this.placementTokens();
        return visibleEditors().map(({ editor, groupId }) =>
          entryOf(editor, groupId, previews, tokens),
        );
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      // Nothing in this capability is asynchronous: the open set, the active
      // editor, dirty and preview are all synchronous workbench state. The
      // envelope is uniform, so this resolves at once and the version is what a
      // consumer compares.
      settled: () => Promise.resolve(),
      version: () => revision,
      actions: {
        activate: (resource: string) => {
          // The same rule as a mount: while this file's close is in flight, activating
          // it would put it back. The reconciliation that calls this compares prac's
          // front view with the app's active editor, and *during* a close those
          // disagree for a moment — prac still shows the file, the app has moved on —
          // so the honest answer is to let the close finish (measured: four
          // activations arriving mid-close left the file open again).
          if (this.isClosingEverywhere(resource)) return;
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
          // **Find the editor, do not re-open by description.** Opening an untyped
          // `{resource}` goes through the editor resolver, whose options can leave the
          // editor inactive (`active: this.count === 0 || !options?.inactive`) — measured:
          // `activate(A)` with A already open did nothing at all, not even a transient
          // change. Naming the editor the group already holds activates it for sure, which
          // is what this action promises.
          const identifiers = this.editorService.findEditors(uri);
          if (identifiers.length === 0) {
            void this.editorService.openEditor({ resource: uri });
            return;
          }
          for (const { groupId, editor } of identifiers) {
            this.editorGroupService.activateGroup(groupId);
            const group = this.editorGroupService.getGroup(groupId);
            if (group !== undefined) void group.openEditor(editor, { preserveFocus: true });
          }
        },
        reorder: (placement: string, resource: string, index: number) => {
          const groupId = this.placements.get(placement)?.group;
          if (groupId === undefined) return;
          const group = this.editorGroupService.getGroup(groupId) as PracWindowGroup | undefined;
          if (group === undefined) return;
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
          const editor = group.editors.find(
            (candidate) => candidate.resource?.toString() === uri.toString(),
          );
          if (editor !== undefined) group.moveEditor(editor, group, { index });
        },
        close: (placement: string, resource: string) => {
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
          // The close is asynchronous, and a **mount** can be in flight while it runs
          // (the frame re-renders the view list in the same layout change). Marking the
          // *placement* for the duration is what keeps that mount from putting the file
          // back: measured, closing a file whose view was re-rendered in the same tick
          // left it open, because the mount's `openEditor` landed after the close.
          const key = placementKey(placement, resource);
          this.closingFiles.add(key);
          // **One placement, not the resource.** A tab names one editor instance; the same
          // file may be open in another region and keeps its own instance there.
          const group = this.placements.get(placement)?.group;
          const identifiers = this.editorService
            .findEditors(uri)
            .filter((identifier) => identifier.groupId === group);
          const closed =
            identifiers.length > 0
              ? this.editorService.closeEditors(identifiers)
              : Promise.resolve();
          void closed.finally(() => this.closingFiles.delete(key));
        },
      },
    };
  }

  /**
   * The diagnostics capability: the marker service, paginated and with a real
   * `settled()`.
   *
   * Markers arrive from language servers and extensions *after* a file is opened,
   * so this is the first capability whose data is genuinely asynchronous — the
   * envelope's `settled` is the point here, not decoration. Its definition is
   * "no marker change for a quiet period", bounded so a consumer can never hang:
   * whatever has arrived has stopped arriving.
   *
   * @returns the capability.
   */
  private createDiagnosticsCapability(): {
    snapshot: () => { summary: DiagnosticsSnapshot["summary"]; page: DiagnosticsPage };
    query: (query: DiagnosticsQuery) => DiagnosticsPage;
    subscribe: (listener: () => void) => () => void;
    settled: () => Promise<void>;
    version: () => number;
    actions: Record<string, never>;
  } {
    const QUIET_MS = 400;
    const MAX_WAIT_MS = 3000;
    const DEFAULT_LIMIT = 100;
    const MAX_SCAN = 5000;
    let revision = 0;
    const listeners = new Set<() => void>();
    this._register(
      this.markerService.onMarkerChanged(() => {
        revision += 1;
        for (const listener of [...listeners]) listener();
      }),
    );
    const severityName = (severity: MarkerSeverity): DiagnosticEntry["severity"] => {
      if (severity === MarkerSeverity.Error) return "error";
      if (severity === MarkerSeverity.Warning) return "warning";
      if (severity === MarkerSeverity.Info) return "info";
      return "hint";
    };
    const rank = { error: 0, warning: 1, info: 2, hint: 3 } as const;
    const entryOf = (marker: IMarker): DiagnosticEntry => ({
      resource: marker.resource.toString(),
      severity: severityName(marker.severity),
      message: marker.message,
      ...(marker.source === undefined ? {} : { source: marker.source }),
      ...(typeof marker.code === "string"
        ? { code: marker.code }
        : marker.code === undefined
          ? {}
          : { code: marker.code.value }),
      range: {
        startLine: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn,
      },
    });
    const readAll = (resource: string | undefined): IMarker[] => {
      const uri =
        resource === undefined
          ? undefined
          : /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
      return this.markerService.read(uri === undefined ? undefined : { resource: uri });
    };
    const page = (query: DiagnosticsQuery): DiagnosticsPage => {
      const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
      const offset = Math.max(0, query.offset ?? 0);
      const all = readAll(query.resource);
      const total = all.length;
      const entries = all
        .slice(0, MAX_SCAN)
        .map(entryOf)
        .sort((a, b) => rank[a.severity] - rank[b.severity] || a.resource.localeCompare(b.resource))
        .slice(offset, offset + limit);
      return {
        entries,
        total,
        offset,
        truncated: offset + entries.length < Math.min(total, MAX_SCAN) || total > MAX_SCAN,
      };
    };
    return {
      snapshot: () => {
        const all = readAll(undefined).map(entryOf);
        const summary = { error: 0, warning: 0, info: 0, hint: 0, resources: 0 };
        for (const entry of all) summary[entry.severity] += 1;
        summary.resources = new Set(all.map((entry) => entry.resource)).size;
        return { summary, page: page({}) };
      },
      query: (query: DiagnosticsQuery) => page(query),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      settled: () =>
        new Promise<void>((resolve) => {
          let quiet: ReturnType<typeof setTimeout> | undefined;
          let cap: ReturnType<typeof setTimeout> | undefined;
          const finish = (): void => {
            if (quiet !== undefined) clearTimeout(quiet);
            if (cap !== undefined) clearTimeout(cap);
            subscription.dispose();
            resolve();
          };
          const subscription = this.markerService.onMarkerChanged(() => {
            if (quiet !== undefined) clearTimeout(quiet);
            quiet = setTimeout(finish, QUIET_MS);
          });
          quiet = setTimeout(finish, QUIET_MS);
          cap = setTimeout(finish, MAX_WAIT_MS);
        }),
      version: () => revision,
      actions: {},
    };
  }

  /** Watch each open input's dirty state, replacing the previous watch set. */
  private watchDirty(store: DisposableStore, notify: () => void): void {
    store.clear();
    for (const editor of this.editorService.editors) {
      store.add(editor.onDidChangeDirty(() => notify()));
    }
  }

  /**
   * Mount a registered part into an external host element (the embedder's shell).
   *
   * Safe to call before the part exists: the element is remembered and used when the
   * part registers. This is the seam the embedder's shell uses to place a part
   * in its own layout region.
   */

  private mountPartInto(partId: string, element: HTMLElement): void {
    if (this.mountedParts.has(partId)) {
      // Already created — possibly detached (see `createDetachedPart`). The
      // embedder asking for it means it wants it visible, so move it there.
      this.movePartInto(partId, element);
      return;
    }
    const part = this.parts.get(partId);
    if (!part) {
      this.deferredHosts.set(partId, element);
      return;
    }
    const { container, options } = this.createPartContainer(partId);
    try {
      // The part renders its own title/content into the given container...
      (part as unknown as { create(parent: HTMLElement, options?: object): void }).create(
        container,
        options,
      );
      // ...and a single-view grid supplies the positioning the part expects.
      // Both shipped workbenches (classic and sessions/Agents Window) place parts
      // through a SerializableGrid; CSS alone leaves a part static and unpainted.
      const grid = new Grid(part as unknown as ISerializableView, { proportionalLayout: false });
      this._register(grid);
      element.replaceChildren(grid.element);
      this.grids.set(partId, grid);
      this.mountedParts.add(partId);
      this.observeHost(element);
      this.partHosts.set(partId, element);
      this.layout();
    } catch (error) {
      this.logService.error(`vscode-embed: failed to mount part ${partId}`, error);
    }
  }

  /**
   * Build the container a part is created into.
   *
   * This mirrors `Workbench.createPart`: the part-specific class is load-bearing,
   * not cosmetic. Part CSS is written against it (`.monaco-workbench .part.editor >
   * .content .grid-view-container { height: 100% }`), so a container that only has
   * `part` collapses the part's internal grid to zero height and the part renders
   * outside its own region — mounted, error-free and invisible.
   */
  private createPartContainer(partId: string): { container: HTMLElement; options?: object } {
    const side = this.getSideBarPosition() === Position.LEFT ? "left" : "right";
    const opposite = side === "left" ? "right" : "left";
    const descriptor =
      partId === Parts.TITLEBAR_PART
        ? { role: "none", classes: ["titlebar"] }
        : partId === Parts.BANNER_PART
          ? { role: "banner", classes: ["banner"] }
          : partId === Parts.ACTIVITYBAR_PART
            ? { role: "none", classes: ["activitybar", side] }
            : partId === Parts.SIDEBAR_PART
              ? { role: "none", classes: ["sidebar", side] }
              : partId === Parts.EDITOR_PART
                ? { role: "main", classes: ["editor"] }
                : partId === Parts.PANEL_PART
                  ? {
                      role: "none",
                      classes: ["panel", "basepanel", positionToString(this.getPanelPosition())],
                    }
                  : partId === Parts.AUXILIARYBAR_PART
                    ? { role: "none", classes: ["auxiliarybar", "basepanel", opposite] }
                    : partId === Parts.STATUSBAR_PART
                      ? { role: "status", classes: ["statusbar"] }
                      : { role: "none", classes: [partId.slice(partId.lastIndexOf(".") + 1)] };

    const container = document.createElement(
      descriptor.role === "status"
        ? "footer" /* Use footer element for status bar #98376 */
        : "div",
    );
    container.classList.add("part", "vscode-embed-part", ...descriptor.classes);
    container.id = partId;
    container.setAttribute("role", descriptor.role);
    if (descriptor.role === "status") {
      container.setAttribute("aria-live", "off");
    }

    return {
      container,
      options: partId === Parts.EDITOR_PART ? { restorePreviousState: false } : undefined,
    };
  }

  /**
   * Re-parent an already-mounted part into another host element.
   *
   * The embedder's shell promotes a surface to the centre and demotes it back, so a
   * mounted part must be *movable* rather than re-creatable: a part is a single
   * instance bound to its services, and `create()` is a one-time act. Moving is
   * therefore `replaceChildren` on the new host plus a fresh layout pass.
   */
  private movePartInto(partId: string, element: HTMLElement): void {
    const grid = this.grids.get(partId);
    if (!grid) {
      this.mountPartInto(partId, element);
      return;
    }
    if (this.partHosts.get(partId) === element) return;
    element.replaceChildren(grid.element);
    this.observeHost(element);
    this.partHosts.set(partId, element);
    this.layout();
  }

  /**
   * Track a host's size so the part follows its region.
   *
   * A host can be resized by the surrounding shell at any time — including from
   * zero width while a column is collapsed — and the workbench's own layout
   * passes never see that.
   */
  private observeHost(element: HTMLElement): void {
    // A part mounted into the embedder's shell is **no longer under the workbench's own
    // root**, and that is where the workbench suppresses the browser's context menu. Without
    // carrying it here, a right-click in a moved-out part (the explorer tree, an editor) opens
    // the workbench's menu *and* the browser's. Measured before this: at the window bubble
    // stage `defaultPrevented` was still false while `.context-view` had already opened.
    if (!suppressedContextMenus.has(element)) {
      suppressedContextMenus.add(element);
      element.addEventListener("contextmenu", (event) => event.preventDefault());
    }
    if (typeof ResizeObserver === "undefined") return;
    this.hostResizeObserver ??= this._register(new ResizeObserver(() => this.layout()));
    this.hostResizeObserver.observe(element);
  }

  /**
   * Open an in-memory untitled editor so the editor part shows content even
   * before a real workspace/file provider is wired.
   */
  openUntitled(): void {
    try {
      const model = this.untitledTextEditorService.create({
        initialValue:
          "# Embedded workbench\n\nThis editor is a VS Code part mounted into an external host.\n\n- VS Code owns the parts + services (extensions, editor, LSP).\n- The embedder owns the layout.\n",
      });
      void this.editorService.openEditor({ resource: model.resource, options: { pinned: true } });
    } catch (error) {
      this.logService.error("vscode-embed: openUntitled failed", error);
    }
  }

  /**
   * The workspace the workbench believes it has (diagnostics).
   *
   * Distinguishes "the folder was never established" from "the folder is
   * established but the tree did not render" — two failures that look the same
   * from the DOM.
   *
   * @returns the workspace folders as strings, plus the workspace id.
   */
  workspaceInfo(): { folders: string[]; id: string } {
    try {
      const context = this.workspaceContextService;
      if (!context) return { folders: [], id: "no-context" };
      const workspace = context.getWorkspace() as {
        id?: string;
        folders?: { uri: { toString(): string } }[];
      };
      return {
        folders: (workspace.folders ?? []).map((folder) => folder.uri.toString()),
        id: workspace.id ?? "?",
      };
    } catch (error) {
      return {
        folders: [],
        id: "threw: " + (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /**
   * Open a folder as the workbench's workspace.
   *
   * The public `vscode.openFolder` command cannot be driven from the embedder:
   * its first argument carries a metadata constraint
   * (`value instanceof URI`, or null/undefined), so every `UriComponents` plain
   * object the page could build is rejected before the handler runs. Inside the
   * workbench we do hold `URI`, so this calls the same command with a real one
   * and no window options — letting it open the folder in *this* window.
   *
   * `forceReuseWindow` must stay off: it routes through the
   * `workspaceProvider.open()` the embedder supplied, which only navigates and
   * therefore does nothing here.
   *
   * @param folderUri - a `vscode-remote://<authority>/<path>` URI, or a bare
   * absolute path, in which case the workbench's own remote authority is used.
   */
  openWorkspaceFolder(folderUri: string): void {
    try {
      const uri = URI.parse(folderUri);
      const services = this.instantiationService;
      if (!services) throw new Error("workbench services are not started");
      const commandService = services.invokeFunction((accessor) => accessor.get(ICommandService));
      void commandService.executeCommand("vscode.openFolder", uri);
    } catch (error) {
      this.logService.error("vscode-embed: openWorkspaceFolder failed", error);
    }
  }

  /** The external host for a part, or the main container as a fallback. */
  private findPartHost(partId: string): HTMLElement {
    const host = mainWindow.document.querySelector<HTMLElement>(`[${PART_HOST_ATTR}="${partId}"]`);
    return host ?? this.mainContainer;
  }

  /** Create each registered part into its host container. */
  private renderParts(): void {
    for (const id of this.parts.keys()) {
      if (this.mountedParts.has(id)) continue;
      const host = this.partHosts.get(id) ?? this.findPartHost(id);
      this.partHosts.set(id, host);
      this.mountPartInto(id, host);
    }
  }

  protected getPart(key: Parts): Part {
    const part = this.parts.get(key);
    if (!part) {
      throw new Error(`vscode-embed: unknown part ${key}`);
    }
    return part;
  }

  //#endregion

  //#region Layout

  layout(): void {
    const containerDimension = this.mainContainer.getBoundingClientRect();
    this._mainContainerDimension.width = containerDimension.width;
    this._mainContainerDimension.height = containerDimension.height;

    for (const [id, grid] of this.grids) {
      const host = this.partHosts.get(id) ?? this.mainContainer;
      const hostDimension = host.getBoundingClientRect();
      const width = hostDimension.width || containerDimension.width;
      const height = hostDimension.height || containerDimension.height;

      try {
        // The grid positions the part view inside the shell's region; the shell
        // owns the outer placement, the grid owns the part's cell.
        grid.layout(width, height);
      } catch (error) {
        this.logService.error(`vscode-embed: failed to layout part ${id}`, error);
      }
    }

    // A view pane is sized by whoever owns it: a `ViewPaneContainer` hands it to
    // a splitview, which sizes the element itself, gives the pane its orthogonal
    // size and then asks it to lay out (`Pane.layout(size)`, upstream
    // `base/browser/ui/splitview/paneview.ts`). A pane mounted into an
    // embedder's element has no container, so this is that job — without it the
    // pane keeps a header's height and everything it renders (a tree, a webview
    // overlay) sits in a zero-height body.
    for (const [id, { pane, host }] of this.mountedViews) {
      const hostDimension = host.getBoundingClientRect();
      const width = hostDimension.width || containerDimension.width;
      const height = hostDimension.height || containerDimension.height;
      try {
        pane.element.style.width = `${width}px`;
        pane.element.style.height = `${height}px`;
        pane.orthogonalSize = width;
        pane.layout(height);
      } catch (error) {
        this.logService.error(`vscode-embed: failed to layout view ${id}`, error);
      }
    }

    for (const { group, element } of this.mountedFiles.values()) {
      try {
        this.layoutGroup(group, element);
      } catch (error) {
        this.logService.error("vscode-embed: failed to layout a prac editor group", error);
      }
    }

    this._onDidLayoutMainContainer.fire(this._mainContainerDimension);
    this._onDidLayoutActiveContainer.fire(this._mainContainerDimension);
    // The third event is the one floats listen to for a re-layout: a quick input
    // re-measures on `onDidLayoutContainer` for its own container, not on the two
    // above, so a container that only fired those kept whatever size it had when
    // the float was created.
    this._onDidLayoutContainer.fire({
      container: this.mainContainer,
      dimension: this._mainContainerDimension,
    });
  }

  getSize(part: Parts): IViewSize {
    const host = this.partHosts.get(part);
    if (host) {
      const dim = host.getBoundingClientRect();
      return { width: dim.width, height: dim.height };
    }
    return { width: 0, height: 0 };
  }

  setSize(part: Parts, size: IViewSize): void {
    const host = this.partHosts.get(part);
    if (host) {
      host.style.width = `${size.width}px`;
      host.style.height = `${size.height}px`;
      this.layout();
    }
  }

  resizePart(part: Parts, sizeChangeWidth: number, sizeChangeHeight: number): void {
    const current = this.getSize(part);
    this.setSize(part, {
      width: current.width + sizeChangeWidth,
      height: current.height + sizeChangeHeight,
    });
  }

  isVisible(part: Parts, targetWindow?: Window): boolean;
  isVisible(part: Parts): boolean;
  isVisible(part: Parts): boolean {
    const host = this.partHosts.get(part);
    if (host) {
      return host.isConnected && host.offsetParent !== null;
    }
    return this.parts.has(part);
  }

  setPartHidden(hidden: boolean, part: Parts): void {
    const host = this.partHosts.get(part);
    if (host) {
      host.style.display = hidden ? "none" : "";
    }
    const instance = this.parts.get(part);
    instance?.setVisible(!hidden);
    this._onDidChangePartVisibility.fire({ partId: part, visible: !hidden });
    this.layout();
  }

  getContainer(targetWindow: Window): HTMLElement;
  getContainer(targetWindow: Window, part: Parts): HTMLElement | undefined;
  getContainer(_targetWindow: Window, part?: Parts): HTMLElement | undefined {
    if (part) {
      return this.partHosts.get(part);
    }
    return this.mainContainer;
  }

  getMaximumEditorDimensions(container: HTMLElement): IDimension {
    const dim = container.getBoundingClientRect();
    return new Dimension(dim.width, dim.height);
  }

  //#endregion

  //#region Minimal semantics (the embedder does not use these yet)

  hasFocus(_part: Parts): boolean {
    return false;
  }
  isFloatingPanelsEnabled(): boolean {
    return false;
  }
  isModernUICompact(): boolean {
    return false;
  }
  focusPart(_part: Parts, _targetWindow?: Window): void {
    /* noop */
  }
  isSecondarySideBarVisible(): boolean {
    return this.isVisible(Parts.AUXILIARYBAR_PART);
  }
  toggleSecondarySideBar(): void {
    this.setPartHidden(this.isVisible(Parts.AUXILIARYBAR_PART), Parts.AUXILIARYBAR_PART);
  }
  toggleMaximizedPanel(): void {
    /* noop */
  }
  isPanelMaximized(): boolean {
    return false;
  }
  toggleMaximizedAuxiliaryBar(): void {
    /* noop */
  }
  setAuxiliaryBarMaximized(_maximized: boolean): boolean {
    return false;
  }
  isAuxiliaryBarMaximized(): boolean {
    return false;
  }
  hasMainWindowBorder(): boolean {
    return false;
  }
  getMainWindowBorderRadius(): string | undefined {
    return undefined;
  }
  toggleMenuBar(): void {
    /* noop */
  }
  toggleZenMode(): void {
    /* noop */
  }
  isMainEditorLayoutCentered(): boolean {
    return false;
  }
  centerMainEditorLayout(_active: boolean): void {
    /* noop */
  }
  isWindowMaximized(_targetWindow: Window): boolean {
    return false;
  }
  updateWindowMaximizedState(_targetWindow: Window, _maximized: boolean): void {
    /* noop */
  }
  getVisibleNeighborPart(_part: Parts, _direction: Direction): Parts | undefined {
    return undefined;
  }
}
