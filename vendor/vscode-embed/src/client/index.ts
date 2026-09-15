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
import type { ReactElement } from "react";
import { EMBED_BRIDGE, PART_HOST_ATTR } from "prac-vscode";
import type { EmbedBridge, PartHostFace } from "prac-vscode";

export { EMBED_BRIDGE, PART_HOST_ATTR };
export type { EmbedBridge, PartHostFace };

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
  /** The element hosting each part, by part id, across all consumers. */
  readonly hosts: Map<string, HTMLElement>;
  /** The element hosting each view, by view id, across all consumers. */
  readonly viewHosts: Map<string, HTMLElement>;
  /** The element hosting each open file, by resource, across all consumers. */
  readonly fileHosts: Map<string, HTMLElement>;
  /**
   * Open-file listeners, and the detach the face gave each one.
   *
   * The app boots *after* its first consumer, so a consumer can subscribe before
   * there is a face to subscribe to; the listener is recorded here and attached
   * when the face arrives (with one immediate call, so the consumer's first read
   * is not lost). Without this, a subscription made during boot is silently a
   * no-op and the consumer never hears about any file the app opens.
   */
  readonly openFileListeners: Map<() => void, (() => void) | undefined>;
  /** Extra classes the consumers want on the boot root (diagnostics). */
  readonly classes: Set<string>;
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
    openFileListeners: new Map(),
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

/** Enter one file into the record and, if the face is up, have it mounted here. */
function mountFile(record: VscodeEmbedPage, resource: string, element: HTMLElement): void {
  record.fileHosts.set(resource, element);
  record.face?.mountFileInto(resource, element);
}

/** The theme classes (`vs` / `vs-dark` / `hc-*`) the app put on its boot root. */
function themeClasses(): string {
  const boot = document.querySelector(`#vscode-embed-boot .monaco-workbench`);
  if (!boot) return "";
  return [...boot.classList].filter((c) => /^(vs|vs-dark|hc-black|hc-light)$/.test(c)).join(" ");
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
}

export interface VscodeEmbedLaunch {
  /** Absolute path of the workspace folder this window is for. */
  readonly workspacePath: string;
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
   * The seat component for **one open file**.
   *
   * The unit is the file (decision 17): the app contributes one file's editing
   * surface, while which files are open, how they are grouped and what the tab
   * strip looks like stay the consumer's business. Unmounting releases the
   * surface, so the same file can be shown again elsewhere.
   *
   * @param resource - the file's URI as the app reports it (`listOpenFiles`).
   * @returns a component rendering the host element the file is mounted into.
   */
  file(resource: string): () => ReactElement;
  /** The files the app currently has open, as URI strings. */
  openFiles(): string[];
  /**
   * Subscribe to changes in the open-file set.
   *
   * @param listener - called when the set changed; re-read {@link openFiles}.
   * @returns a function that unsubscribes.
   */
  onDidChangeOpenFiles(listener: () => void): () => void;
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
    Object.assign(bootHost.style, {
      position: "fixed",
      width: "0",
      height: "0",
      overflow: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(bootHost);
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
          mod.create(bootHost, {
            productConfiguration: {
              nameShort: productName,
              nameLong: productName,
              applicationName: productName,
            },
            // The embed bridge: the app mounts no parts on its own, and hands its
            // part-hosting face back through `publish`. The field name and the
            // face's shape come from the one contract both sides compile
            // (`prac-vscode` → staged into the checkout as `embedBridge.ts`).
            [EMBED_BRIDGE]: {
              deferParts: true,
              publish: (face: PartHostFace) => {
                record.face = face;
                for (const [partId, element] of record.hosts) face.movePartInto(partId, element);
                for (const [viewId, element] of record.viewHosts)
                  face.mountViewInto(viewId, element);
                for (const [resource, element] of record.fileHosts)
                  face.mountFileInto(resource, element);
                // Attach the listeners that arrived before the app did, then let
                // them read the set once.
                for (const [listener, detach] of record.openFileListeners) {
                  if (detach === undefined) {
                    record.openFileListeners.set(listener, face.onDidChangeOpenFiles(listener));
                  }
                }
                for (const listener of record.openFileListeners.keys()) listener();
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

  const partHost = (partId: string): (() => ReactElement) => {
    return function VscodePartHost(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        let themeTimer: ReturnType<typeof setInterval> | undefined;
        // The theme class (`vs` / `vs-dark`) appears shortly after startup, so
        // copy it onto the host once it is known — theme-gated layout rules need it.
        const applyTheme = (): void => {
          const theme = themeClasses();
          if (!theme) return;
          for (const name of theme.split(" ")) {
            if (!element.classList.contains(name)) element.classList.add(name);
          }
          if (themeTimer !== undefined) {
            clearInterval(themeTimer);
            themeTimer = undefined;
          }
        };
        applyTheme();
        themeTimer = setInterval(applyTheme, 200);
        mountPart(record, partId, element);
        return () => {
          if (themeTimer !== undefined) clearInterval(themeTimer);
          if (record.hosts.get(partId) === element) record.hosts.delete(partId);
        };
      }, []);
      return createElement("div", {
        ref,
        // The app's CSS is scoped under `.monaco-workbench` (and its theme
        // classes `.vs` / `.vs-dark`); a part mounted outside that context is
        // unstyled. Mirror both so the scoped rules apply here.
        className: `monaco-workbench vscode-embed-part-host ${themeClasses()}`.trim(),
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
        mountView(record, viewId, element);
        return () => {
          if (record.viewHosts.get(viewId) !== element) return;
          record.viewHosts.delete(viewId);
          record.face?.releaseView(viewId);
        };
      }, []);
      return createElement("div", {
        ref,
        // A view brings its own pane (header and body), so the host only has to
        // size it: the app's CSS scopes the pane under the theme classes the
        // boot root carries.
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

  const file = (resource: string): (() => ReactElement) => {
    return function VscodeFileHost(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        mountFile(record, resource, element);
        return () => {
          if (record.fileHosts.get(resource) !== element) return;
          record.fileHosts.delete(resource);
          record.face?.releaseFile(resource);
        };
      }, []);
      return createElement("div", {
        ref,
        // An editor widget carries its own theme classes from the app's global
        // styles; the host only has to size it.
        "data-vscode-embed-file": resource,
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

  return {
    boot,
    partHost,
    view,
    file,
    openFiles: () => record.face?.listOpenFiles() ?? [],
    onDidChangeOpenFiles: (listener: () => void): (() => void) => {
      const detach = record.face?.onDidChangeOpenFiles(listener);
      record.openFileListeners.set(listener, detach);
      return () => {
        record.openFileListeners.delete(listener);
        detach?.();
      };
    },
    commands: () => record.commands,
    host: () => record.host,
    error: () => record.error,
    page: record,
  };
}
