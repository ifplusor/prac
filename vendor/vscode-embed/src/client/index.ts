/**
 * prac-vscode-embed — browser half.
 *
 * The mechanism for running the built Code - OSS app inside a page someone else
 * owns, and for handing its part-hosting face to that page:
 *
 * 1. **the singleton boot** — `create()` may be called at most once per page, so
 *    booting goes through a page-level record rather than through module state.
 *    That matters because a consumer's bundle *inlines* this module: two
 *    consumers would be two module instances, and only a page-level record lets
 *    them share one boot, one face and one set of hosts.
 * 2. **the part host element factory** — a React component per part id; its
 *    element is handed to the app's face (`movePartInto`), so the part lands
 *    wherever the consumer's own shell put it.
 * 3. **the app's own handles** — its command namespace, its boot element and its
 *    failure, for whoever needs them next.
 *
 * Everything is a parameter here: the route, the product name, the remote
 * authority and the workspace. Which part backs which view, and when the app may
 * boot at all, are the consumer's policy.
 *
 * @module prac-vscode-embed/client
 */

import { createElement, useEffect, useRef } from "react";
import { deliverThemeToHost } from "./theme-root.js";
import type { ReactElement } from "react";
import { EMBED_BRIDGE, FLOAT_HOST_ATTR, PART_HOST_ATTR } from "prac-vscode";
import type {
  DiagnosticEntry,
  DiagnosticsPage,
  DiagnosticsQuery,
  DiagnosticsSnapshot,
  EditorEntry,
  EmbedBridge,
  FilePlacement,
  PartHostFace,
  ViewCatalogueEntry,
} from "prac-vscode";

export { EMBED_BRIDGE, FLOAT_HOST_ATTR, PART_HOST_ATTR };
export type {
  DiagnosticEntry,
  DiagnosticsPage,
  DiagnosticsQuery,
  DiagnosticsSnapshot,
  EditorEntry,
  EmbedBridge,
  PartHostFace,
  ViewCatalogueEntry,
};

/** The command namespace the app module publishes. */
export interface CommandNamespace {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * The page-level record: the **only** place state is shared between the copies
 * of this module that end up inlined in different consumer bundles.
 *
 * @see {@link VscodeEmbedHandle.page}
 */
export interface VscodeEmbedPage {
  /** The once-per-page guard: the app is started at most once. */
  started: boolean;
  /** The element `create()` mounted the app into (parts are moved out of it). */
  host?: HTMLElement;
  /** The app module's command namespace, once its module has loaded. */
  commands?: CommandNamespace;
  /** Why the boot rejected, when it did (diagnostics only). */
  error?: string;
  /** The app's part-hosting face, once its service graph has restored. */
  face?: PartHostFace;
  /** The app's region channel, kept until the workbench publishes a face to hand it to. */
  groupRegionChannel?: {
    createRegionBeside(region: string, side: "left" | "right" | "up" | "down"): string | undefined;
    removeRegion(region: string): void;
    regionInDirection(region: string, side: "left" | "right" | "up" | "down"): string | undefined;
    removeRegion(region: string): void;
  };
  /** The element hosting each part, by part id, across all consumers. */
  readonly hosts: Map<string, HTMLElement>;
  /** The element hosting each view, by view id, across all consumers. */
  readonly viewHosts: Map<string, HTMLElement>;
  /**
   * The element hosting each **file placement**, by placement key, across all consumers.
   *
   * The value keeps the group and the resource the key was built from, so the face can
   * be handed the placement it names rather than a key it would have to parse.
   */
  readonly fileHosts: Map<string, FileHost>;
  /**
   * Placement listeners, and the detach the face gave each one.
   *
   * The app boots *after* its first consumer, so a consumer can subscribe before
   * there is a face to subscribe to; the listener is recorded here and attached
   * when the face arrives (with one immediate call, so the consumer's first read
   * is not lost). Without this, a subscription made during boot is silently a
   * no-op and the consumer never hears about any file the app opens.
   */
  readonly placementListeners: Map<() => void, (() => void) | undefined>;
  /** View-catalogue listeners, recorded until the face arrives (same reason). */
  readonly viewCatalogueListeners: Map<() => void, (() => void) | undefined>;
  /** Subscribers to the `editors` capability, recorded until the face arrives. */
  readonly editorsListeners: Map<() => void, (() => void) | undefined>;
  /** Subscribers to the `diagnostics` capability, recorded until the face arrives. */
  readonly diagnosticsListeners: Map<() => void, (() => void) | undefined>;
  /** Extra classes the consumers want on the boot root (diagnostics). */
  readonly classes: Set<string>;
  /**
   * The embedder's float-layer element, once its entry rendered.
   *
   * Recorded rather than looked up: the layer lives in the frame's overlay slot,
   * which renders inside an isolation root, so a document query cannot see it —
   * the entry hands its element over instead (the same handover the part hosts do
   * through the face). Until it arrives the app's root falls back to `body`.
   */
  floatHost?: HTMLElement;
}

declare global {
  /** The page-level record; see {@link VscodeEmbedPage}. */
  var __vscodeEmbed: VscodeEmbedPage | undefined;
  /** The app bundle's file root (VS Code reads it at boot). */
  var _VSCODE_FILE_ROOT: string | undefined;
}

/** The page-level record, created on first use. */
function page(): VscodeEmbedPage {
  const existing = globalThis.__vscodeEmbed;
  if (existing !== undefined) return existing;
  const record: VscodeEmbedPage = {
    started: false,
    hosts: new Map(),
    viewHosts: new Map(),
    fileHosts: new Map(),
    placementListeners: new Map(),
    viewCatalogueListeners: new Map(),
    editorsListeners: new Map(),
    diagnosticsListeners: new Map(),
    classes: new Set(),
  };
  globalThis.__vscodeEmbed = record;
  return record;
}

/** Enter one part into the record and, if the face is up, hand it over. */
function mountPart(record: VscodeEmbedPage, partId: string, element: HTMLElement): void {
  record.hosts.set(partId, element);
  record.face?.movePartInto(partId, element);
}

/** Enter one view into the record and, if the face is up, have it created here. */
function mountView(record: VscodeEmbedPage, viewId: string, element: HTMLElement): void {
  record.viewHosts.set(viewId, element);
  record.face?.mountViewInto(viewId, element);
}

/** Enter one file placement into the record and, if the face is up, have it mounted. */
function mountFile(
  record: VscodeEmbedPage,
  placement: string,
  resource: string,
  element: HTMLElement,
): void {
  record.fileHosts.set(placementKey(placement, resource), { placement, resource, element });
  record.face?.mountFileInto(placement, resource, element);
}

/** One file placement's host element, as the page record holds it. */
interface FileHost {
  /** The placement token, as the workbench handed it out. */
  readonly placement: string;
  /** The file's URI, as a string. */
  readonly resource: string;
  /** The element the consumer rendered for this placement's view. */
  readonly element: HTMLElement;
}

/**
 * The key one file placement is held under.
 *
 * The placement — a file in one group — is what a host element shows, so the file
 * alone cannot be the key: the same file open in two groups is two hosts at once.
 *
 * @param group - the group holding the file.
 * @param resource - the file's URI, as a string.
 */
function placementKey(placement: string, resource: string): string {
  return `${placement}\u0000${resource}`;
}

export interface VscodeEmbedOptions {
  /** Same-origin URL prefix the built bundle is served under. */
  readonly route: string;
  /** Authority the app's remote connection goes to. Defaults to the page's own host. */
  readonly remoteAuthority?: string;
  /** Product name the app shows. Defaults to `"vscode"`. */
  readonly productName?: string;
  /** Path the code server is reached on. Defaults to `"/"`. */
  readonly serverBasePath?: string;
  /** Route the code server redirects its callback to. Defaults to `"/callback"`. */
  readonly callbackRoute?: string;
  /**
   * The extension gallery the **client** should use.
   *
   * The OSS product ships none, and the client's product configuration is separate
   * from the server's `product.json`: the server can have a gallery stamped while
   * the client still reports "No extension gallery service configured". The
   * consumer supplies it (`prac-vscode`'s `gallery.json`) so both planes read one
   * source.
   */
  readonly extensionsGallery?: Record<string, string>;
}

export interface VscodeEmbedLaunch {
  /** Absolute path of the workspace folder this window is for. */
  readonly workspacePath: string;
  /**
   * Configuration defaults for the workbench, merged into its own.
   *
   * Mechanism only: which defaults a product wants is its policy. It exists
   * because a **web** workbench differs from the documented desktop one —
   * notably `files.autoSave`, whose upstream default is
   * `isWeb ? afterDelay : off` (`files.contribution.ts:270`), so a product that
   * wants the documented behaviour has to say so.
   */
  readonly configurationDefaults?: Record<string, unknown>;
}

export interface VscodeEmbedHandle {
  /**
   * Start the app for one workspace — at most once per page.
   *
   * The workspace is a launch parameter rather than a construction option
   * because it is the consumer's to resolve, and because the app's window
   * identity (which scopes storage, configuration and profile) is fixed by it
   * for the life of the page: it cannot be corrected after the fact.
   *
   * @returns whether the app is running or was already started.
   */
  boot(launch: VscodeEmbedLaunch): boolean;
  /**
   * The seat component for one part id.
   *
   * @param partId - the part id (`workbench.parts.editor`).
   * @returns a component rendering the host element the part is mounted into.
   */
  partHost(partId: string): () => ReactElement;
  /**
   * The seat component for one view id.
   *
   * A view is the finer unit: its own pane, outside any part, so two views can
   * sit in one region and a region can be rebuilt without touching the rest of
   * the app. Unmounting releases it (`releaseView`), so it can be created again.
   *
   * @param viewId - the view id (`workbench.explorer.fileView`).
   * @returns a component rendering the host element the view is created into.
   */
  view(viewId: string): () => ReactElement;
  /**
   * Make one view the focused view.
   *
   * @param viewId - the workbench view id.
   */
  focusView(viewId: string): void;
  /**
   * Execute a workbench command, for diagnostics and for callers that need the
   * command itself rather than a DOM action.
   *
   * @param command - the command id.
   * @param args - forwarded arguments.
   */
  runCommand(command: string, ...args: unknown[]): Promise<unknown>;
  /**
   * The seat component for **one file placement**.
   *
   * The unit is the placement — a file in one editor group (decision 17, made precise
   * by split editors): the app contributes one file's editing surface per group showing
   * it, while which files are open, how they are grouped and what the tab strip looks
   * like stay the consumer's business. The token is what tells two placements of the
   * same file apart, and what decides where the editor goes: the embedder renders one
   * seat per placement, and a seat rendered in another region moves that placement's
   * surface there rather than opening a second editor. Unmounting releases the surface,
   * so the same placement can be shown again elsewhere.
   *
   * @param placement - the placement token, from the `editors` capability or
   * {@link placements}.
   * @param resource - the file's URI as the app reports it (`listOpenFiles`).
   * @returns a component rendering the host element the file is mounted into.
   */
  file(placement: string, resource: string): () => ReactElement;
  /**
   * The file placements the app currently has open.
   *
   * Read live from the face, so it is empty until the app boots. A placement is a file
   * in one group; the same file in two groups is two of these.
   */
  placements(): readonly FilePlacement[];
  /**
   * Register the gate-only timeline provider (see the workbench's face doc).
   */
  enableTimelineProbe(): void;
  /**
   * Install the app's region channel for the workbench's `addGroup`: in prac a group *is* a
   * region, so the frame makes the region (synchronously) and the host binds the group to
   * the id it returns.
   *
   * @param factory - the frame's split, as a synchronous question.
   */
  setGroupRegionChannel(channel: {
    createRegionBeside(region: string, side: "left" | "right" | "up" | "down"): string | undefined;
    removeRegion(region: string): void;
    regionInDirection(region: string, side: "left" | "right" | "up" | "down"): string | undefined;
  }): void;
  /**
   * Subscribe to changes in the placement set.
   *
   * @param listener - called when the set changed; re-read {@link placements}.
   * @returns a function that unsubscribes.
   */
  onDidChangePlacements(listener: () => void): () => void;
  /** The files the app currently has open, as URI strings (placement-blind). */
  openFiles(): string[];
  /**
   * The views the app currently offers, across every container.
   *
   * Read live from the face, so it is empty until the app boots and grows as
   * extensions activate. Each entry carries a container and a location, which a
   * consumer uses for its own default placement — the app does not lay anything
   * out.
   */
  views(): readonly ViewCatalogueEntry[];
  /**
   * Subscribe to changes in the view catalogue.
   *
   * @param listener - called when the active view set changed; re-read {@link views}.
   * @returns a function that unsubscribes.
   */
  onDidChangeViews(listener: () => void): () => void;
  /**
   * The **float layer** component: where the app's own root is mounted.
   *
   * The embedder renders this into its floating layer (the frame's whole-surface
   * overlay slot) so the surfaces the app creates directly — quick input,
   * notifications, the context-view container, dialogs — live in the embedder's
   * layer rather than a second layer beside its frame. One layer means one order:
   * which of the two sides paints above the other is the slot entry's `order`, not
   * an accident of DOM insertion.
   *
   * The element carries {@link FLOAT_HOST_ATTR}, is click-through (the app's own
   * root and every float it has not opted in stay click-through too, so the frame
   * underneath keeps its events), and **sizes the app's root**: the app measures
   * its container for every float it places.
   *
   * @returns a component rendering the element the app is mounted into.
   */
  floatHost(): () => ReactElement;
  /**
   * The app's capabilities, addressed by name.
   *
   * Each member reads the app's face when called, so a consumer may hold the
   * handle before the app has booted; subscriptions made that early are attached
   * when the face arrives (and called once, so the first read is not lost).
   */
  readonly capabilities: {
    /** The open editor set — the UI's tab state and the agent's context. */
    readonly editors: {
      snapshot(): readonly EditorEntry[];
      subscribe(listener: () => void): () => void;
      settled(): Promise<void>;
      version(): number;
      readonly actions: {
        /** Make a file's editor the app's active one. */
        activate(resource: string): void;
        /**
         * Close one placement's editor.
         *
         * @param placement - the placement whose editor should close.
         * @param resource - the app's URI for the file.
         */
        close(placement: string, resource: string): void;
      };
    };
    /**
     * The problems the app knows about.
     *
     * The first capability whose data arrives *late* (a language server answers
     * after the file opens), so `settled()` is the member that matters: a consumer
     * that skips it reads an incomplete set as if it were the truth.
     */
    readonly diagnostics: {
      snapshot(): DiagnosticsSnapshot;
      query(query: DiagnosticsQuery): DiagnosticsPage;
      subscribe(listener: () => void): () => void;
      settled(): Promise<void>;
      version(): number;
    };
  };
  /** The app's command namespace, once its module has loaded. */
  commands(): CommandNamespace | undefined;
  /** The element the app was mounted into, once booted. */
  host(): HTMLElement | undefined;
  /** Why the boot rejected, if it did. */
  error(): string | undefined;
  /** The page-level record this handle reads and writes. */
  readonly page: VscodeEmbedPage;
}

/**
 * Build a handle onto the embedded app for one page.
 *
 * The handle carries no per-launch state: {@link VscodeEmbedHandle.boot} does,
 * so a consumer may create the handle before it knows the workspace (which is
 * often the case — the workspace may only appear later).
 */
/**
 * The webview endpoint the deployment configured, if any.
 *
 * It arrives as an index injection: a template with `{{uuid}}` in it, which the
 * workbench substitutes with the hash of this page's origin — that hash *is* the
 * hostname the webview host page insists on, so the name has to be a wildcard
 * the deployment controls (the chain is documented in `prac-host-vscode`'s
 * `webview-origin` module). Nothing is derived here: with nothing configured we
 * pass nothing and the build's own endpoint stands.
 *
 * @returns the template, or `undefined` when the page was not given one.
 */
function webviewEndpoint(): string | undefined {
  const injected = (globalThis as { __pracVscodeWebviewEndpoint?: unknown })
    .__pracVscodeWebviewEndpoint;
  return typeof injected === "string" && injected !== "" ? injected : undefined;
}

/**
 * The ancestor class the app's view CSS is scoped under.
 *
 * The app writes `.monaco-workbench .outline-pane { … }`, so any host prac mounts
 * workbench content into has to carry this class **inside the isolation root** —
 * that is what confines the cascade to the borrowed content instead of waking it
 * over the whole page. See the part host below for the measurement.
 */
const WORKBENCH_CONTEXT = "monaco-workbench";

export function createVscodeEmbed(options: VscodeEmbedOptions): VscodeEmbedHandle {
  const record = page();
  const route = options.route.replace(/\/+$/, "");
  const remoteAuthority = options.remoteAuthority ?? location.host;
  const productName = options.productName ?? "vscode";
  const serverBasePath = options.serverBasePath ?? "/";
  const callbackRoute = options.callbackRoute ?? "/callback";

  const boot = (launch: VscodeEmbedLaunch): boolean => {
    if (record.started) return true;
    record.started = true;

    const bootHost = document.createElement("div");
    bootHost.id = "vscode-embed-boot";
    bootHost.classList.add(...record.classes);
    // The app's **own root** lives in the embedder's float layer, not beside its
    // frame: what the app creates directly (quick input, notifications, the
    // context-view container, dialogs) belongs to that layer — one layer, one
    // order. The parts are moved out into the embedder's regions either way, so
    // nothing else follows the root in.
    //
    // Filling the layer is what gives the app a box at all: the app measures its
    // own container for every float it places (a command palette is
    // `0.62 × container width`), so a root with no box means floats with no box.
    // `pointer-events: none` keeps the frame clickable; the float containers
    // themselves opt back in (see the app overlay's stylesheet).
    const floatHostElement = record.floatHost ?? document.body;
    Object.assign(bootHost.style, {
      position: "absolute",
      inset: "0",
      overflow: "visible",
      pointerEvents: "none",
      zIndex: "0",
    });
    floatHostElement.appendChild(bootHost);
    record.host = bootHost;

    globalThis._VSCODE_FILE_ROOT = new URL(`${route}/`, location.origin).toString();

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${route}/vs/workbench/workbench.web.main.internal.css`;
    document.head.appendChild(css);

    const nls = document.createElement("script");
    nls.type = "module";
    nls.src = `${route}/nls.messages.js`;
    document.head.appendChild(nls);

    const appModule = `${route}/vs/workbench/workbench.web.main.internal.js`;
    import(/* @vite-ignore */ appModule)
      .then(
        (mod: {
          create(host: HTMLElement, options: unknown): unknown;
          commands: CommandNamespace;
        }) => {
          // `create()` returns only a disposable, not the app: the module's
          // `commands` namespace is the public face (it awaits the internal
          // startup promise). `bootHost` keeps living on as the element the parts
          // are mounted from.
          record.commands = mod.commands;
          const endpoint = webviewEndpoint();
          mod.create(bootHost, {
            ...(launch.configurationDefaults === undefined
              ? {}
              : { configurationDefaults: launch.configurationDefaults }),
            // Webviews must not be this page's origin (a webview is third-party
            // content in a frame sandboxed with `allow-scripts` +
            // `allow-same-origin`, which is only a boundary when the origin
            // differs), and their host page further insists on a secure context
            // whose hostname is the hash of this page's origin. So the endpoint
            // is a template the deployment provides — `https://{{uuid}}.<wildcard
            // name>/…` — and the workbench substitutes the hash for `{{uuid}}`.
            ...(endpoint === undefined ? {} : { webviewEndpoint: endpoint }),
            productConfiguration: {
              nameShort: productName,
              nameLong: productName,
              applicationName: productName,
              ...(options.extensionsGallery === undefined
                ? {}
                : { extensionsGallery: options.extensionsGallery }),
            },
            // The embed bridge: the app mounts no parts on its own, and hands its
            // part-hosting face back through `publish`. The field name and the
            // face's shape come from the one contract both sides compile
            // (`prac-vscode` → staged into the checkout as `embedBridge.ts`).
            [EMBED_BRIDGE]: {
              deferParts: true,
              publish: (face: PartHostFace) => {
                record.face = face;
                // The app may install the region channel before the workbench publishes its
                // face (it boots asynchronously); hand it over then.
                if (record.groupRegionChannel !== undefined) {
                  face.setGroupRegionChannel(record.groupRegionChannel);
                }
                for (const [partId, element] of record.hosts) face.movePartInto(partId, element);
                for (const [viewId, element] of record.viewHosts)
                  face.mountViewInto(viewId, element);
                for (const { placement, resource, element } of record.fileHosts.values())
                  face.mountFileInto(placement, resource, element);
                // Attach the listeners that arrived before the app did, then let
                // them read the set once.
                for (const [listener, detach] of record.placementListeners) {
                  if (detach === undefined) {
                    record.placementListeners.set(listener, face.onDidChangePlacements(listener));
                  }
                }
                for (const listener of record.placementListeners.keys()) listener();
                for (const [listener, detach] of record.viewCatalogueListeners) {
                  if (detach === undefined) {
                    record.viewCatalogueListeners.set(listener, face.onDidChangeViews(listener));
                  }
                }
                for (const listener of record.viewCatalogueListeners.keys()) listener();
                for (const [listener, detach] of record.editorsListeners) {
                  if (detach === undefined) {
                    record.editorsListeners.set(
                      listener,
                      face.capabilities.editors.subscribe(listener),
                    );
                  }
                }
                for (const listener of record.editorsListeners.keys()) listener();
                for (const [listener, detach] of record.diagnosticsListeners) {
                  if (detach === undefined) {
                    record.diagnosticsListeners.set(
                      listener,
                      face.capabilities.diagnostics.subscribe(listener),
                    );
                  }
                }
                for (const listener of record.diagnosticsListeners.keys()) listener();
              },
            } satisfies EmbedBridge,
            // Point the app at the code server. The recipe mirrors what the
            // server's own bootstrap injects into its page
            // (`vscode-workbench-web-configuration`): remoteAuthority +
            // serverBasePath + callbackRoute.
            remoteAuthority,
            serverBasePath,
            callbackRoute,
            // The workspace this window belongs to. The construction options only
            // *identify* it (storage and profile state); they do not open it, which
            // is why opening is a separate act.
            workspaceProvider: {
              workspace: {
                folderUri: {
                  scheme: "vscode-remote",
                  authority: remoteAuthority,
                  path: launch.workspacePath,
                },
              },
              trusted: true,
              // Not implemented, and deliberately not faked. The app calls this to
              // move this window to another workspace, which in a browser means
              // loading a different page; until workspace switching has a real
              // answer, answer "no" so callers see it fail rather than believe a
              // switch happened.
              open: async () => false,
            },
          });
        },
      )
      .catch((error: unknown) => {
        console.error("[vscode-embed] boot failed", error);
        record.error = String(error);
      });

    return true;
  };

  /**
   * The float-layer component: the element the app's own root is mounted into.
   *
   * One element, and the embedder decides where it sits and what paints above it
   * (the slot entry's `order`). This side only records it, so `boot()` can mount
   * into it instead of `body` — and if the app has already booted by the time the
   * entry renders, the root moves in here.
   *
   * @returns the component the embedder renders into its floating layer.
   */
  const floatHost = (): (() => ReactElement) => {
    return function VscodeFloatHost(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        record.floatHost = element;
        // Boot with no layer yet: the root went to `body`, so move it now. The
        // app's parts are hosted elsewhere and do not move with it.
        if (record.host !== undefined && record.host.parentElement !== element) {
          element.appendChild(record.host);
        }
        return () => {
          if (record.floatHost === element) delete record.floatHost;
        };
      }, []);
      return createElement("div", {
        ref,
        [FLOAT_HOST_ATTR]: "",
        // Inline `pointer-events` beats the slot's own rule (an overlay entry opts
        // into events by default): the layer must stay click-through, and the app's
        // float containers opt back in one by one (see the app overlay's stylesheet).
        style: { position: "absolute", inset: 0, pointerEvents: "none" },
      });
    };
  };

  const partHost = (partId: string): (() => ReactElement) => {
    return function VscodePartHost(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        // The host lives inside the view's isolation root, where the app's theme
        // variables have to be delivered (`:host`) instead of inherited.
        const stopTheme = deliverThemeToHost(element);
        mountPart(record, partId, element);
        return () => {
          stopTheme?.();
          if (record.hosts.get(partId) === element) record.hosts.delete(partId);
        };
      }, []);
      return createElement("div", {
        ref,
        // `monaco-workbench` is load-bearing, not decoration: most of the app's
        // view CSS is scoped under it (`.monaco-workbench .outline-pane …`), and
        // the frame deliberately does *not* put that class on the isolation host —
        // so without it here the rules are mirrored into the root and match
        // nothing. Measured: the Outline's message stayed visible and its tree
        // sized to its content (7612px inside a 734px region) until this class was
        // on an ancestor inside the root. `theme-root.ts` still delivers the
        // variables through `:host`; this only restores the selectors' context.
        className: "vscode-embed-part-host monaco-workbench",
        [PART_HOST_ATTR]: partId,
        // Inline sizing beats the class's absolute positioning so the host stays
        // inside its region instead of escaping the frame.
        style: {
          position: "relative",
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        },
      });
    };
  };

  const view = (viewId: string): (() => ReactElement) => {
    return function VscodeView(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        const stopTheme = deliverThemeToHost(element);
        mountView(record, viewId, element);
        return () => {
          stopTheme?.();
          if (record.viewHosts.get(viewId) !== element) return;
          record.viewHosts.delete(viewId);
          record.face?.releaseView(viewId);
        };
      }, []);
      return createElement("div", {
        ref,
        // A view brings its own pane (header and body), so the host only has to
        // size it — and to carry `monaco-workbench`, which is the ancestor the
        // app's pane CSS is scoped under (see the part host above).
        className: WORKBENCH_CONTEXT,
        "data-vscode-embed-view": viewId,
        style: {
          position: "relative",
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        },
      });
    };
  };

  const file = (placement: string, resource: string): (() => ReactElement) => {
    const key = placementKey(placement, resource);
    return function VscodeFileHost(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        const stopTheme = deliverThemeToHost(element);
        mountFile(record, placement, resource, element);
        // The app follows *its* active editor, and the embedder knows which region
        // the person is working in — so focus has to travel back up. Without this
        // the Outline (and every command) would keep describing whichever file was
        // mounted last. The placement, not the file: the same file can be shown in
        // two regions, and only the focused one is where the person is working.
        const onFocusIn = (): void => {
          // A view the frame has **detached** is not where the person is working. While
          // a region swaps its body, the group's element is re-parented between the two
          // file hosts, and a pane focus landing inside the detached one raised a
          // `focusin` that read as "work here" — measured, it pulled the app's active
          // editor back to the file that was just giving up the centre, and prac then
          // followed it, leaving the new file's view with no surface.
          if (!element.isConnected) return;
          record.face?.focusFile(placement, resource);
        };
        element.addEventListener("focusin", onFocusIn);
        return () => {
          element.removeEventListener("focusin", onFocusIn);
          stopTheme?.();
          if (record.fileHosts.get(key)?.element !== element) return;
          record.fileHosts.delete(key);
          record.face?.releaseFile(placement, resource);
        };
      }, []);
      return createElement("div", {
        ref,
        // An editor widget carries its own theme classes from the app's global
        // styles; the host sizes it and carries `monaco-workbench`, the ancestor
        // the editor chrome's rules are scoped under.
        className: WORKBENCH_CONTEXT,
        "data-vscode-embed-file": resource,
        "data-vscode-embed-placement": placement,
        style: {
          position: "relative",
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        },
      });
    };
  };

  const editors = {
    snapshot: (): readonly EditorEntry[] => record.face?.capabilities.editors.snapshot() ?? [],
    subscribe: (listener: () => void): (() => void) => {
      const detach = record.face?.capabilities.editors.subscribe(listener);
      record.editorsListeners.set(listener, detach);
      return () => {
        record.editorsListeners.delete(listener);
        detach?.();
      };
    },
    settled: (): Promise<void> => record.face?.capabilities.editors.settled() ?? Promise.resolve(),
    version: (): number => record.face?.capabilities.editors.version() ?? 0,
    actions: {
      activate: (resource: string): void => {
        record.face?.capabilities.editors.actions.activate(resource);
      },
      close: (placement: string, resource: string): void => {
        record.face?.capabilities.editors.actions.close(placement, resource);
      },
    },
  };

  const diagnostics = {
    snapshot: (): DiagnosticsSnapshot =>
      record.face?.capabilities.diagnostics.snapshot() ?? {
        summary: { error: 0, warning: 0, info: 0, hint: 0, resources: 0 },
        page: { entries: [], total: 0, offset: 0, truncated: false },
      },
    query: (query: DiagnosticsQuery): DiagnosticsPage =>
      record.face?.capabilities.diagnostics.query(query) ?? {
        entries: [],
        total: 0,
        offset: query.offset ?? 0,
        truncated: false,
      },
    subscribe: (listener: () => void): (() => void) => {
      const detach = record.face?.capabilities.diagnostics.subscribe(listener);
      record.diagnosticsListeners.set(listener, detach);
      return () => {
        record.diagnosticsListeners.delete(listener);
        detach?.();
      };
    },
    settled: (): Promise<void> =>
      record.face?.capabilities.diagnostics.settled() ?? Promise.resolve(),
    version: (): number => record.face?.capabilities.diagnostics.version() ?? 0,
  };

  return {
    boot,
    floatHost,
    partHost,
    view,
    file,
    focusView: (viewId: string): void => {
      record.face?.focusView(viewId);
    },
    runCommand: (command: string, ...args: unknown[]): Promise<unknown> =>
      record.commands?.executeCommand(command, ...args) ?? Promise.resolve(undefined),
    capabilities: { editors, diagnostics },
    placements: () => record.face?.listPlacements() ?? [],
    enableTimelineProbe: (): void => {
      record.face?.enableTimelineProbe();
    },
    setGroupRegionChannel: (channel: {
      createRegionBeside(
        region: string,
        side: "left" | "right" | "up" | "down",
      ): string | undefined;
      regionInDirection(region: string, side: "left" | "right" | "up" | "down"): string | undefined;
      removeRegion(region: string): void;
    }): void => {
      record.groupRegionChannel = channel;
      record.face?.setGroupRegionChannel(channel);
    },
    onDidChangePlacements: (listener: () => void): (() => void) => {
      const detach = record.face?.onDidChangePlacements(listener);
      record.placementListeners.set(listener, detach);
      return () => {
        record.placementListeners.delete(listener);
        detach?.();
      };
    },
    openFiles: () => record.face?.listOpenFiles() ?? [],
    views: () => record.face?.listViews() ?? [],
    onDidChangeViews: (listener: () => void): (() => void) => {
      const detach = record.face?.onDidChangeViews(listener);
      record.viewCatalogueListeners.set(listener, detach);
      return () => {
        record.viewCatalogueListeners.delete(listener);
        detach?.();
      };
    },
    commands: () => record.commands,
    host: () => record.host,
    error: () => record.error,
    page: record,
  };
}
