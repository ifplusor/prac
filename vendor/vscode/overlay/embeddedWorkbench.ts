/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { Dimension, IDimension } from "../../base/browser/dom.js";
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
import { IPaneCompositePartService } from "../services/panecomposite/browser/panecomposite.js";
import { IViewDescriptorService } from "../common/views.js";
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
// `vendor/vscode/overlay/bridge.ts`, so both sides read one definition.
import { PART_HOST_ATTR, readEmbedBridge } from "./embedBridge.js";
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
  private readonly mountedViews = new Map<string, ViewPane>();

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
    parent.appendChild(this.mainContainer);
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
          bridge.publish({
            mountPartInto: (partId: string, element: HTMLElement) =>
              this.mountPartInto(partId, element),
            movePartInto: (partId: string, element: HTMLElement) =>
              this.movePartInto(partId, element),
            mountViewInto: (viewId: string, element: HTMLElement) =>
              this.mountViewInto(viewId, element),
            releaseView: (viewId: string) => this.releaseView(viewId),
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
      element.replaceChildren(mounted.element);
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
      this.mountedViews.set(viewId, pane);
      this._register(pane);
      element.replaceChildren(pane.element);
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
    const pane = this.mountedViews.get(viewId);
    if (!pane) return;
    this.mountedViews.delete(viewId);
    pane.setVisible(false);
    pane.dispose();
  }

  /**
   * Mount a registered part into an external host element (the embedder's shell).
   *
   * Safe to call before the part exists: the element is remembered and used when the
   * part registers. This is the seam the embedder's shell uses to place a part
   * in its own layout region.
   */
  mountPartInto(partId: string, element: HTMLElement): void {
    if (this.mountedParts.has(partId)) return;
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

    this._onDidLayoutMainContainer.fire(this._mainContainerDimension);
    this._onDidLayoutActiveContainer.fire(this._mainContainerDimension);
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
