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
import { getSingletonServiceDescriptors } from "../../platform/instantiation/common/extensions.js";
import { ILayoutOffsetInfo, ILayoutService } from "../../platform/layout/browser/layoutService.js";
import { ILogService } from "../../platform/log/common/log.js";
import { IStorageService } from "../../platform/storage/common/storage.js";
import { IConfigurationService } from "../../platform/configuration/common/configuration.js";
import { IThemeService } from "../../platform/theme/common/themeService.js";
import { IHostService } from "../services/host/browser/host.js";
import { INotificationService } from "../../platform/notification/common/notification.js";
import { ICommandService } from "../../platform/commands/common/commands.js";
import { IEditorService } from "../services/editor/common/editorService.js";
import { IUntitledTextEditorService } from "../services/untitled/common/untitledTextEditorService.js";
import { URI } from "../../base/common/uri.js";
import { IEditorGroupsService } from "../services/editor/common/editorGroupsService.js";
import type { EditorInput } from "../common/editor/editorInput.js";
import { IPaneCompositePartService } from "../services/panecomposite/browser/panecomposite.js";
import { IViewDescriptorService, ViewContainerLocationToString } from "../common/views.js";
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
import { CodeEditorWidget } from "../../editor/browser/widget/codeEditor/codeEditorWidget.js";
import { ITextModelService } from "../../editor/common/services/resolverService.js";
import { IMarkerService, MarkerSeverity } from "../../platform/markers/common/markers.js";
import type { IMarker } from "../../platform/markers/common/markers.js";
import type { IResolvedTextEditorModel } from "../../editor/common/services/resolverService.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import type { IReference } from "../../base/common/lifecycle.js";
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
import { IEditorFactoryRegistry, EditorExtensions } from "../common/editor.js";
import { WorkbenchContextKeysHandler } from "./contextkeys.js";
import { setARIAContainer } from "../../base/browser/ui/aria/aria.js";
import { setHoverDelegateFactory } from "../../base/browser/ui/hover/hoverDelegateFactory.js";
import { setBaseLayerHoverDelegate } from "../../base/browser/ui/hover/hoverDelegate2.js";
// The embed bridge contract. `embedBridge.ts` is staged into this tree by this
// package's build (`vendor/vscode/scripts/build.mjs`) from
// `vendor/vscode/overlay/embedBridge.ts`, so both sides read one definition.
import { PART_HOST_ATTR, readEmbedBridge, type ViewCatalogueEntry } from "./embedBridge.js";
import { IHoverService, WorkbenchHoverDelegate } from "../../platform/hover/browser/hover.js";
import { IMarkdownRendererService } from "../../platform/markdown/browser/markdownRenderer.js";
import { EditorMarkdownCodeBlockRenderer } from "../../editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js";
import "./style.js";

/** Options an embedder may pass to the workbench. */
export interface IEmbeddedWorkbenchOptions {
  /** Extra classes on the root container. */
  extraClasses?: string[];
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
  /**
   * One editing surface per resource, mounted by the embedder.
   *
   * The reference is what keeps the workbench's text model alive while this
   * surface shows it; releasing it lets the model go when nothing else holds it.
   */
  private readonly mountedFiles = new Map<
    string,
    { readonly editor: ICodeEditor; readonly reference: IReference<IResolvedTextEditorModel> }
  >();
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
   * context-view container — menus and dialogs — hover, notifications). Anything
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
.monaco-workbench > .notifications-center { pointer-events: auto; }
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
          // The editor service needs its part to exist even though the embedder
          // renders files itself; it is created off-screen and never hosted.
          this.createDetachedPart("workbench.parts.editor");
          bridge.publish({
            mountPartInto: (partId: string, element: HTMLElement) =>
              this.mountPartInto(partId, element),
            movePartInto: (partId: string, element: HTMLElement) =>
              this.movePartInto(partId, element),
            mountViewInto: (viewId: string, element: HTMLElement) =>
              this.mountViewInto(viewId, element),
            releaseView: (viewId: string) => this.releaseView(viewId),
            listViews: () => this.listViews(),
            onDidChangeViews: (listener: () => void) => this.onDidChangeViews(listener),
            mountFileInto: (resource: string, element: HTMLElement) =>
              this.mountFileInto(resource, element),
            focusFile: (resource: string) => this.focusFile(resource),
            releaseFile: (resource: string) => this.releaseFile(resource),
            openFile: (resource: string) => this.openFile(resource),
            capabilities: {
              editors: this.createEditorsCapability(),
              diagnostics: this.createDiagnosticsCapability(),
            },
            listOpenFiles: () => this.listOpenFiles(),
            onDidChangeOpenFiles: (listener: () => void) => this.onDidChangeOpenFiles(listener),
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

    const instantiationService = new InstantiationService(serviceCollection, true);
    instantiationService.invokeFunction((accessor) => {
      accessor.get(ILifecycleService).phase = LifecyclePhase.Ready;
    });
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
    mounted.pane.setVisible(false);
    mounted.pane.dispose();
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

  /** Subscribe to catalogue changes (see {@link PartHostFace.onDidChangeViews}). */
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
   * Mount one file's editing surface into an external host element.
   *
   * The unit is the **file**, because the embedder owns which files are open,
   * their grouping and their tab strip. What the workbench contributes is the
   * editing surface itself, built the way the workbench builds it
   * (`TextCodeEditor.createEditorControl`): a `CodeEditorWidget` over the
   * workbench's own text model for the resource, so language features, markers,
   * undo/redo and saving are the real ones rather than a re-implementation.
   *
   * The resource may arrive as a full URI string (`vscode-remote://…`, which is
   * what the app's own workspace folders look like) or as a bare path; the
   * embedder cannot construct a `URI` instance, so the string is parsed here —
   * the same reason `openWorkspaceFolder` takes a string.
   *
   * Model loading is asynchronous, so this registers the element first and
   * fills it in when the model resolves; a failed load is reported and leaves
   * the host empty rather than half-mounted.
   */
  mountFileInto(resource: string, element: HTMLElement): void {
    const mounted = this.mountedFiles.get(resource);
    if (mounted) {
      // One surface per file: the same file asked for twice is the same editor,
      // re-parented — a second editor would be a second view of one model.
      element.replaceChildren(mounted.editor.getDomNode() ?? element);
      return;
    }
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
        const textModelService = accessor.get(ITextModelService);
        const reference = await textModelService.createModelReference(uri);
        // Mirrors the options `BaseTextEditor` hands its control, plus
        // `automaticLayout`: the embedder's regions resize, and nothing here
        // would otherwise tell the widget to lay out again.
        const editor = instantiationService.createInstance(
          CodeEditorWidget,
          element,
          {
            automaticLayout: true,
            fixedOverflowWidgets: true,
            renderValidationDecorations: "on",
          },
          Object.create(null),
        ) as unknown as ICodeEditor;
        editor.setModel(reference.object.textEditorModel);
        this.mountedFiles.set(resource, { editor, reference });
        this._register(editor as unknown as IDisposable);
        this._register(reference);
      })
      .catch((error) => {
        this.logService.error(`vscode-embed: failed to mount file ${resource}`, error);
      });
  }

  /**
   * Dispose the editing surface for a file, so it can be mounted again.
   *
   * The text model is not the embedder's to destroy: the reference taken by
   * {@link mountFileInto} is released, and the model goes when nothing else
   * holds it (another surface, or a dirty buffer).
   */
  releaseFile(resource: string): void {
    const mounted = this.mountedFiles.get(resource);
    if (!mounted) return;
    this.mountedFiles.delete(resource);
    mounted.editor.dispose();
    mounted.reference.dispose();
  }

  /**
   * Make one mounted file the app's active editor.
   *
   * The embedder calls this when its region for the file takes focus. The workbench
   * follows *its* active editor — the Outline, the Timeline and every command read
   * it — and the embedder is the only side that knows which region a person is
   * working in, so focus has to travel up. Without it the app keeps describing
   * whichever file was opened last.
   *
   * Activation only: the surface a person sees is the embedder's own widget, so
   * this moves the workbench's notion of "current" and nothing else.
   *
   * @param resource - the file's resource string, as {@link mountFileInto} took it.
   */
  focusFile(resource: string): void {
    try {
      const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
        ? URI.parse(resource)
        : URI.file(resource);
      const identifier = this.editorService.findEditors(uri)[0];
      if (!identifier) return;
      // `preserveFocus` because the person's focus is already where it should be;
      // this only tells the workbench which editor is current.
      void identifier.group.openEditor(identifier.editor, { preserveFocus: true });
      this.editorGroupService.activateGroup(identifier.group);
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
    }[];
    subscribe: (listener: () => void) => () => void;
    settled: () => Promise<void>;
    version: () => number;
    actions: { activate: (resource: string) => void; close: (resource: string) => void };
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
    const entryOf = (editor: EditorInput, previews: ReadonlySet<EditorInput>) => ({
      resource: editor.resource?.toString() ?? "",
      active: editor === this.editorService.activeEditor,
      dirty: editor.isDirty(),
      preview: previews.has(editor),
    });
    const visibleEditors = (): EditorInput[] => {
      return this.editorService.editors.filter(
        (editor) => editor.resource !== undefined && this.fileService.hasProvider(editor.resource),
      );
    };
    const previewsOf = (): Set<EditorInput> => {
      const previews = new Set<EditorInput>();
      for (const group of this.editorGroupService.groups) {
        if (group.previewEditor) previews.add(group.previewEditor);
      }
      return previews;
    };
    this._register(this.editorService.onDidEditorsChange(() => notify()));
    this.watchDirty(dirtyListeners, notify);
    return {
      snapshot: () => {
        const previews = previewsOf();
        return visibleEditors().map((editor) => entryOf(editor, previews));
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
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
          void this.editorService.openEditor({ resource: uri });
        },
        close: (resource: string) => {
          const uri = /^[a-z][a-z0-9+.-]*:\/\//i.test(resource)
            ? URI.parse(resource)
            : URI.file(resource);
          const identifiers = this.editorService.findEditors(uri);
          if (identifiers.length > 0) void this.editorService.closeEditors(identifiers);
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
   * Subscribe to changes in the open-file set.
   *
   * Two of the editor service's events can mean "the set changed" (activate,
   * close) and neither *is* the set, so the set is compared here: the listener
   * hears exactly when the list it would read differs from the one it last saw.
   * `onDidVisibleEditorsChange` is deliberately not used — the editor part may
   * never be mounted in this composition, so "visible" is not ours to rely on.
   *
   * @param listener - called when the open-file set changed.
   * @returns a function that unsubscribes.
   */
  onDidChangeOpenFiles(listener: () => void): () => void {
    let last = this.listOpenFiles().join("\n");
    const notify = (): void => {
      const next = this.listOpenFiles().join("\n");
      if (next === last) return;
      last = next;
      listener();
    };
    const store = new DisposableStore();
    store.add(this.editorService.onDidActiveEditorChange(notify));
    store.add(this.editorService.onDidCloseEditor(notify));
    return () => store.dispose();
  }

  /**
   * Mount a registered part into an external host element (the embedder's shell).
   *
   * Safe to call before the part exists: the element is remembered and used when the
   * part registers. This is the seam the embedder's shell uses to place a part
   * in its own layout region.
   */
  /**
   * Create a part into a hidden container the frame never shows.
   *
   * Some services need their part to *exist* — the editor service opens editors
   * through the editor part's groups — while the embedder renders those files
   * itself as views (decision 17). Measured: with the editor part never created,
   * `openEditor` throws `Cannot read properties of undefined (reading
   * 'isLocked')` and no file ever opens, so "retire the part" has to mean
   * "create it, never host it" rather than "never create it".
   *
   * The part is registered as mounted, so a later `mountPartInto` *moves* this
   * same instance instead of creating a second one.
   *
   * @param partId - the workbench part id.
   */
  private createDetachedPart(partId: string): void {
    const element = mainWindow.document.querySelector<HTMLElement>("[data-vscode-embed-detached]");
    const host =
      element ??
      (() => {
        const created = mainWindow.document.createElement("div");
        created.setAttribute("data-vscode-embed-detached", partId);
        created.style.cssText = "position:absolute;left:-100000px;top:0;width:800px;height:600px";
        mainWindow.document.body.append(created);
        return created;
      })();
    this.mountPartInto(partId, host);
  }

  mountPartInto(partId: string, element: HTMLElement): void {
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
  movePartInto(partId: string, element: HTMLElement): void {
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
