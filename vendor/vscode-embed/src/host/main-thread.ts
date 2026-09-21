/**
 * The minimum "main thread" an extension host needs: the actors the host calls,
 * the data it has to be handed before it will run anything, and the two ways to
 * ask it to do something (activate, and query a registered provider).
 *
 * Mechanism only. Which extensions exist, what the workspace is and which
 * documents are worth feeding stay with the consumer; what lives here is the
 * shape of the conversation, which is fixed by the protocol:
 *
 * - **two barriers before anything activates**: `$initializeWorkspace` and
 *   `$initializeConfiguration`. Upstream's barriers have no timeout, so a host
 *   that is not fed them waits forever rather than failing;
 * - **documents are pushed, not pulled**: the host keeps a mirror built from
 *   `$acceptDocumentsAndEditorsDelta`, and a provider call for a document that
 *   was never pushed rejects;
 * - **actors we do not implement answer `undefined`**. A call to an unregistered
 *   actor is answered `Unknown actor`, which the host sees as a failed call —
 *   so every `MainContext` identifier gets a recording fallback, and a gap shows
 *   up in {@link MainThreadHandle.unhandled} instead of as an extension that
 *   mysteriously will not start.
 *
 * @module prac-vscode-embed/host/main-thread
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { configurationDefaults, extensionsDelta, type ExtensionDescription } from "./extensions.js";
import {
  startExtensionHost,
  type ExtensionHostHandle,
  type ExtensionHostLocation,
  type ExtensionHostProtocol,
  type RpcProtocol,
  type RpcProxyIdentifier,
  type UriLike,
} from "./extension-host.js";

/** Which language feature a registration is for, named as the protocol names it. */
export type LanguageFeatureKind =
  | "completion"
  | "hover"
  | "definition"
  | "declaration"
  | "typeDefinition"
  | "implementation"
  | "references"
  | "documentSymbol"
  | "documentHighlight"
  | "documentLink"
  | "codeAction"
  | "codeLens"
  | "documentFormatting"
  | "documentRangeFormatting"
  | "onTypeFormatting"
  | "rename"
  | "color"
  | "foldingRange"
  | "selectionRange"
  | "semanticTokens"
  | "inlayHint"
  | "callHierarchy"
  | "typeHierarchy"
  | "inlineCompletion"
  | "documentDropEdit"
  | "documentPasteEdit"
  | "evaluate"
  | "linkedEditing";

/** One provider the host registered with us. */
export interface LanguageFeatureRegistration {
  readonly kind: LanguageFeatureKind;
  /** Opaque key: hand it back when calling the provider. */
  readonly handle: number;
  /** `IDocumentFilterDto[]`, as sent — language / scheme / pattern. */
  readonly selector: readonly unknown[];
}

/** A document the host should mirror. */
export interface MainThreadDocument {
  readonly uri: UriLike;
  readonly languageId: string;
  readonly text: string;
  readonly versionId?: number;
}

/** The workspace the host should believe it is in. */
export interface MainThreadWorkspace {
  readonly id: string;
  readonly name: string;
  readonly folders: readonly {
    readonly uri: UriLike;
    readonly name: string;
    readonly index: number;
  }[];
}

export interface MainThreadEnvironment {
  readonly appName: string;
  readonly appHost: string;
  readonly appUriScheme: string;
  /** The host's language; `en` keeps localisation out of the picture. */
  readonly appLanguage?: string;
  readonly globalStorageHome: UriLike;
  readonly workspaceStorageHome: UriLike;
  readonly telemetry: {
    readonly sessionId: string;
    readonly machineId: string;
    readonly sqmId: string;
    readonly devDeviceId: string;
    readonly firstSessionDate: string;
  };
}

/** Everything policy-shaped about the host. */
export interface MainThreadPolicy {
  readonly environment: MainThreadEnvironment;
  /** The scanned extension list — see `scanExtensions`. */
  readonly extensions: readonly ExtensionDescription[];
  /**
   * Which extensions are **enabled**, i.e. belong to this host's `myExtensions`
   * half; all of them when left out.
   *
   * It is a predicate rather than a list because it is applied on every scan,
   * not once: an extension installed while a host is running has to be judged by
   * the same policy as the ones already there. Ids arrive as the extension's own
   * spelling (`publisher.name`); a policy that cares about case should fold it.
   */
  readonly isEnabled?: (extensionId: string) => boolean;
  readonly workspace?: MainThreadWorkspace | null;
  /**
   * Flat configuration defaults. Left out, they are expanded from the
   * extensions' own `contributes.configuration` — which is what makes an
   * extension's declared defaults visible to the extension itself.
   */
  readonly configuration?: Readonly<Record<string, unknown>>;
  /** Documents to feed before activation. */
  readonly documents?: readonly MainThreadDocument[];
  readonly logLevel?: number;
  /** Called for every call to an actor this module does not implement. */
  readonly onUnhandledCall?: (call: { readonly actor: string; readonly method: string }) => void;
  /** Called with the host's own output and with activation failures. */
  readonly onLog?: (message: string) => void;
}

/** A position on zero-based line/character coordinates. */
export interface ProviderPosition {
  readonly line: number;
  readonly character: number;
}

/** A range on zero-based coordinates, half-open. */
export interface ProviderRange {
  readonly start: ProviderPosition;
  readonly end: ProviderPosition;
}

/** Somewhere a provider pointed at. */
export interface ProviderLocation {
  readonly uri: UriLike;
  readonly range: ProviderRange;
}

/** What a hover provider answered. */
export interface ProviderHover {
  readonly contents: string;
  readonly range?: ProviderRange;
}

/** A running extension host with the minimum main thread attached. */
export interface MainThreadHandle {
  readonly rpc: RpcProtocol;
  readonly protocol: ExtensionHostProtocol;
  readonly initData: Record<string, unknown>;
  readonly child: ChildProcess;
  /** Providers the host has registered so far. */
  readonly registrations: readonly LanguageFeatureRegistration[];
  /**
   * Extensions whose activation has finished, successfully or not.
   *
   * What this is for: once an extension is in here and a provider it was
   * expected to register is absent, waiting longer cannot help — the answer is
   * that it does not provide that operation, and saying so immediately beats
   * holding a caller for a timeout.
   */
  readonly activated: ReadonlySet<string>;
  /** Calls that hit the fallback actor, in order. */
  readonly unhandled: readonly { readonly actor: string; readonly method: string }[];
  /** Ask the host to activate whatever wants this event. */
  activateByEvent(event: string): Promise<void>;
  /** Ask the host to activate one extension by id. */
  activate(extensionId: string): Promise<boolean>;
  /**
   * Tell a running host which extensions exist now.
   *
   * The host's registry is built from the init data it was started with; this is
   * how it learns about one that appeared (or vanished) since — installing an
   * extension does not require restarting the host, and so does not throw away
   * the language servers it already started.
   */
  setExtensions(extensions: readonly ExtensionDescription[]): Promise<boolean>;
  /** The extension set the host currently knows about. */
  readonly extensions: readonly ExtensionDescription[];
  /** Feed a document, or update one already fed. */
  openDocument(document: MainThreadDocument): void;
  /** Drop a document from the host's mirror. */
  closeDocument(uri: UriLike): void;
  /**
   * Ask the provider registered under `handle` — the four the seam of a coding
   * agent needs. Positions are **zero-based** here; the protocol's are one-based
   * and the conversion stays on this side.
   */
  provideHover(
    handle: number,
    uri: UriLike,
    position: ProviderPosition,
    signal?: AbortSignal,
  ): Promise<ProviderHover | null>;
  provideDefinition(
    handle: number,
    uri: UriLike,
    position: ProviderPosition,
    signal?: AbortSignal,
  ): Promise<ProviderLocation[]>;
  provideImplementation(
    handle: number,
    uri: UriLike,
    position: ProviderPosition,
    signal?: AbortSignal,
  ): Promise<ProviderLocation[]>;
  provideReferences(
    handle: number,
    uri: UriLike,
    position: ProviderPosition,
    signal?: AbortSignal,
  ): Promise<ProviderLocation[]>;
  dispose(): Promise<void>;
}

/** The ext-host proxies this module calls; only the methods it uses. */
interface ExtHostProxies {
  readonly configuration: { $initializeConfiguration(data: unknown): void };
  readonly workspace: { $initializeWorkspace(workspace: unknown, trusted: boolean): void };
  readonly documentsAndEditors: { $acceptDocumentsAndEditorsDelta(delta: unknown): void };
  readonly documents: {
    $acceptModelChanged(uri: UriLike, event: unknown, isDirty: boolean): void;
    $acceptModelLanguageChanged(uri: UriLike, languageId: string): void;
  };
  readonly extensionService: {
    $activateByEvent(event: string, kind: number): Promise<void>;
    $activate(extensionId: unknown, reason: unknown): Promise<boolean>;
    $deltaExtensions(delta: unknown): Promise<void>;
  };
  readonly telemetry: { $initializeTelemetryLevel(level: number, supported: boolean): void };
  readonly languages: { $acceptLanguageIds(ids: readonly string[]): void };
  readonly languageFeatures: {
    $provideHover(
      handle: number,
      resource: UriLike,
      position: { lineNumber: number; column: number },
      context: unknown,
      token: unknown,
    ): Promise<{ contents?: { value?: string }[]; range?: VsRange } | undefined>;
    $provideDefinition(
      handle: number,
      resource: UriLike,
      position: { lineNumber: number; column: number },
      token: unknown,
    ): Promise<VsLocation[] | undefined>;
    $provideImplementation(
      handle: number,
      resource: UriLike,
      position: { lineNumber: number; column: number },
      token: unknown,
    ): Promise<VsLocation[] | undefined>;
    $provideReferences(
      handle: number,
      resource: UriLike,
      position: { lineNumber: number; column: number },
      context: unknown,
      token: unknown,
    ): Promise<VsLocation[] | undefined>;
  };
}

/** A 1-based range, as the protocol sends it. */
interface VsRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

/** A location as the protocol sends it; links point at a target range. */
interface VsLocation {
  readonly uri?: UriLike;
  readonly range?: VsRange;
  readonly targetUri?: UriLike;
  readonly targetRange?: VsRange;
  readonly targetSelectionRange?: VsRange;
}

/**
 * Start a host and attach the minimum main thread to it.
 *
 * Resolves once the host has been fed the data it cannot run without (workspace,
 * configuration, telemetry level, documents). Activation is a separate call:
 * the host starts extensions on its own side, and asking for one is
 * {@link MainThreadHandle.activateByEvent}.
 */
export async function startMainThread(options: {
  readonly location: ExtensionHostLocation;
  readonly policy: MainThreadPolicy;
  readonly onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}): Promise<MainThreadHandle> {
  const { policy } = options;
  /**
   * The policy on which extensions are enabled. The neutral default — none of
   * them filtered — keeps the mechanism usable on its own (a test, or an
   * embedder with no opinion), while an embedder that has a policy states it.
   */
  const enabled = policy.isEnabled ?? (() => true);
  const registrations: LanguageFeatureRegistration[] = [];
  const unhandled: { actor: string; method: string }[] = [];
  const markers = new Map<string, unknown>();
  /** What the host has been told about each document, so we never re-add one. */
  const mirror = new Map<string, MirrorEntry>();
  /** Extensions whose activation has finished — see `MainThreadHandle.activated`. */
  const activated = new Set<string>();
  /** The extension set the host knows, kept live because it can change. */
  const known: ExtensionDescription[] = [...policy.extensions];
  let registryVersion = 1;
  const defaults = policy.configuration ?? configurationDefaults(policy.extensions);
  const log = policy.onLog ?? (() => undefined);

  const host: ExtensionHostHandle = await startExtensionHost({
    location: options.location,
    onOutput: options.onOutput,
    initData: {
      environment: {
        appName: policy.environment.appName,
        appHost: policy.environment.appHost,
        appLanguage: policy.environment.appLanguage ?? "en",
        appUriScheme: policy.environment.appUriScheme,
        globalStorageHome: policy.environment.globalStorageHome,
        workspaceStorageHome: policy.environment.workspaceStorageHome,
      },
      workspace: policy.workspace ? workspaceData(policy.workspace) : null,
      extensions: {
        versionId: 1,
        allExtensions: policy.extensions,
        activationEvents: Object.fromEntries(
          policy.extensions.map((extension) => [
            extension.identifier.value,
            extension.activationEvents ?? [],
          ]),
        ),
        myExtensions: policy.extensions
          .filter((extension) => enabled(extension.identifier.value))
          .map((extension) => extension.identifier),
      },
      telemetryInfo: policy.environment.telemetry,
      logLevel: policy.logLevel ?? 3,
      autoStart: true,
    },
    configure: ({ rpc, protocol }) => {
      const proxies = extHostProxies(rpc, protocol);
      registerActors({
        rpc,
        protocol,
        proxies,
        registrations,
        unhandled,
        markers,
        mirror,
        activated,
        extensions: known,
        onUnhandledCall: policy.onUnhandledCall,
        onLog: log,
      });
    },
  });

  const proxies = extHostProxies(host.rpc, host.protocol);
  proxies.configuration.$initializeConfiguration(configurationData(defaults));
  proxies.workspace.$initializeWorkspace(
    policy.workspace ? workspaceData(policy.workspace) : null,
    true,
  );
  proxies.telemetry.$initializeTelemetryLevel(policy.logLevel ?? 3, false);
  proxies.languages.$acceptLanguageIds([]);
  for (const document of policy.documents ?? []) openDocument(proxies, mirror, document);

  return {
    rpc: host.rpc,
    protocol: host.protocol,
    initData: host.initData,
    child: host.child,
    registrations,
    activated,
    unhandled,
    activateByEvent: (event) => proxies.extensionService.$activateByEvent(event, 0),
    setExtensions: async (next) => {
      registryVersion += 1;
      const delta = extensionsDelta(known, next, registryVersion, enabled);
      if (delta === undefined) return false;
      await proxies.extensionService.$deltaExtensions(delta);
      known.splice(0, known.length, ...next);
      return true;
    },
    extensions: known,
    activate: (extensionId) => {
      const identifier = { value: extensionId, _lower: extensionId.toLowerCase() };
      return proxies.extensionService.$activate(identifier, {
        startup: false,
        extensionId: identifier,
        activationEvent: undefined,
      });
    },
    openDocument: (document) => openDocument(proxies, mirror, document),
    closeDocument: (uri) => {
      mirror.delete(uriKey(uri));
      proxies.documentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: [uri] });
    },
    provideHover: async (handle, uri, position, signal) => {
      const hover = await proxies.languageFeatures.$provideHover(
        handle,
        uri,
        toVsPosition(position),
        undefined,
        await tokenFor(options.location, signal),
      );
      if (!hover) return null;
      // The protocol answers with markdown parts; the seam wants one string.
      const contents = (hover.contents ?? [])
        .map((part) => part.value ?? "")
        .filter((value) => value !== "")
        .join("\n\n");
      const range = toProviderRange(hover.range);
      return range ? { contents, range } : { contents };
    },
    provideDefinition: (handle, uri, position, signal) =>
      locationsFrom(options.location, signal, (token) =>
        proxies.languageFeatures.$provideDefinition(handle, uri, toVsPosition(position), token),
      ),
    provideImplementation: (handle, uri, position, signal) =>
      locationsFrom(options.location, signal, (token) =>
        proxies.languageFeatures.$provideImplementation(handle, uri, toVsPosition(position), token),
      ),
    provideReferences: (handle, uri, position, signal) =>
      locationsFrom(options.location, signal, (token) =>
        // References always include the declaration: an agent asking where a
        // symbol is used wants to see the definition too.
        proxies.languageFeatures.$provideReferences(
          handle,
          uri,
          toVsPosition(position),
          { includeDeclaration: true },
          token,
        ),
      ),
    dispose: () => host.dispose(),
  };
}

/** Run one location-returning provider call and normalise what comes back. */
async function locationsFrom(
  location: ExtensionHostLocation,
  signal: AbortSignal | undefined,
  call: (token: unknown) => Promise<VsLocation[] | undefined>,
): Promise<ProviderLocation[]> {
  const result = await call(await tokenFor(location, signal));
  return (result ?? [])
    .map(toProviderLocation)
    .filter((entry): entry is ProviderLocation => entry !== undefined);
}

function toVsPosition(position: ProviderPosition): { lineNumber: number; column: number } {
  return { lineNumber: position.line + 1, column: position.character + 1 };
}

function toProviderRange(range: VsRange | undefined): ProviderRange | undefined {
  if (!range) return undefined;
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}

function toProviderLocation(location: VsLocation): ProviderLocation | undefined {
  const uri = location.targetUri ?? location.uri;
  const range = toProviderRange(
    location.targetSelectionRange ?? location.targetRange ?? location.range,
  );
  if (!uri || !range) return undefined;
  return { uri, range };
}

/**
 * A protocol cancellation token driven by the caller's signal.
 *
 * The protocol hands providers a token, not an `AbortSignal`; adapting here
 * keeps that difference out of the consumer, which only ever sees the signal the
 * seam gives it.
 */
async function tokenFor(location: ExtensionHostLocation, signal?: AbortSignal): Promise<unknown> {
  const module = (await import(
    pathToFileURL(join(location.outBuild, "vs/base/common/cancellation.js")).href
  )) as { CancellationTokenSource: new () => { token: unknown; cancel(): void } };
  const source = new module.CancellationTokenSource();
  if (signal?.aborted) source.cancel();
  else signal?.addEventListener("abort", () => source.cancel(), { once: true });
  return source.token;
}

/** What we have already pushed for a document; the host keeps no other copy. */
interface MirrorEntry {
  readonly versionId: number;
  readonly text: string;
  readonly languageId: string;
}

function openDocument(
  proxies: ExtHostProxies,
  mirror: Map<string, MirrorEntry>,
  document: MainThreadDocument,
): void {
  const key = uriKey(document.uri);
  const current = mirror.get(key);
  if (!current) {
    const versionId = document.versionId ?? 1;
    proxies.documentsAndEditors.$acceptDocumentsAndEditorsDelta({
      addedDocuments: [
        {
          uri: document.uri,
          versionId,
          // The whole text: the host builds its mirror from this and never asks
          // us for content again.
          lines: document.text.split(/\r\n|\n/),
          EOL: document.text.includes("\r\n") ? "\r\n" : "\n",
          languageId: document.languageId,
          isDirty: false,
          encoding: "utf8",
        },
      ],
    });
    mirror.set(key, { versionId, text: document.text, languageId: document.languageId });
    return;
  }

  // Adding a document the host already holds throws *inside the host*, and the
  // throw takes the host process with it — so everything after the first push
  // has to be a change, even when the answer is "the same as before".
  if (current.text !== document.text) {
    const versionId = current.versionId + 1;
    proxies.documents.$acceptModelChanged(
      document.uri,
      {
        // A whole-document replacement expressed as one change: the host
        // applies ranges, so the range has to describe exactly what it holds.
        changes: [
          {
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: lineCount(current.text),
              endColumn: lastColumn(current.text),
            },
            rangeLength: current.text.length,
            text: document.text,
          },
        ],
        eol: document.text.includes("\r\n") ? "\r\n" : "\n",
        versionId,
      },
      false,
    );
    mirror.set(key, { ...current, versionId, text: document.text });
  }
  if (current.languageId !== document.languageId) {
    proxies.documents.$acceptModelLanguageChanged(document.uri, document.languageId);
    mirror.set(key, { ...mirror.get(key)!, languageId: document.languageId });
  }
}

/** How many lines a text consists of, counting the trailing empty one. */
function lineCount(text: string): number {
  return text.split(/\r\n|\n/).length;
}

/** One past the last character of the last line, one-based. */
function lastColumn(text: string): number {
  const lines = text.split(/\r\n|\n/);
  return (lines[lines.length - 1]?.length ?? 0) + 1;
}

/** A map key for a URI in the protocol's shape. */
function uriKey(uri: UriLike): string {
  const withAuthority = uri as UriLike & { readonly authority?: string };
  return `${uri.scheme}://${withAuthority.authority ?? ""}${uri.path}`;
}

function workspaceData(workspace: MainThreadWorkspace): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    folders: workspace.folders.map((folder) => ({
      uri: folder.uri,
      name: folder.name,
      index: folder.index,
    })),
  };
}

/** An empty configuration layer, the shape `IConfigurationModel` uses. */
function configurationModel(
  contents: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { contents, keys: Object.keys(contents), overrides: [] };
}

function configurationData(defaults: Readonly<Record<string, unknown>>): unknown {
  // Every scope is present but empty: the host parses this once and reads it
  // locally, so an empty layer is an empty layer rather than an error.
  return {
    defaults: configurationModel(defaults),
    policy: configurationModel(),
    application: configurationModel(),
    userLocal: configurationModel(),
    userRemote: configurationModel(),
    workspace: configurationModel(),
    folders: [],
    configurationScopes: [],
  };
}

function extHostProxies(rpc: RpcProtocol, protocol: ExtensionHostProtocol): ExtHostProxies {
  const proxy = (name: string): unknown => {
    const identifier = protocol.ExtHostContext[name];
    if (!identifier) throw new Error(`the build has no ExtHostContext.${name}`);
    return rpc.getProxy(identifier as RpcProxyIdentifier<unknown>);
  };
  return {
    configuration: proxy("ExtHostConfiguration") as ExtHostProxies["configuration"],
    workspace: proxy("ExtHostWorkspace") as ExtHostProxies["workspace"],
    documentsAndEditors: proxy(
      "ExtHostDocumentsAndEditors",
    ) as ExtHostProxies["documentsAndEditors"],
    documents: proxy("ExtHostDocuments") as ExtHostProxies["documents"],
    extensionService: proxy("ExtHostExtensionService") as ExtHostProxies["extensionService"],
    telemetry: proxy("ExtHostTelemetry") as ExtHostProxies["telemetry"],
    languages: proxy("ExtHostLanguages") as ExtHostProxies["languages"],
    languageFeatures: proxy("ExtHostLanguageFeatures") as ExtHostProxies["languageFeatures"],
  };
}

/** The `$register…` methods that carry a provider registration, and its kind. */
const REGISTER_METHODS: readonly [method: string, kind: LanguageFeatureKind][] = [
  ["$registerHoverProvider", "hover"],
  ["$registerDefinitionSupport", "definition"],
  ["$registerDeclarationSupport", "declaration"],
  ["$registerTypeDefinitionSupport", "typeDefinition"],
  ["$registerImplementationSupport", "implementation"],
  ["$registerReferenceSupport", "references"],
  ["$registerDocumentSymbolProvider", "documentSymbol"],
  ["$registerDocumentHighlightProvider", "documentHighlight"],
  ["$registerDocumentLinkProvider", "documentLink"],
  ["$registerCodeActionSupport", "codeAction"],
  ["$registerCodeLensSupport", "codeLens"],
  ["$registerDocumentFormattingSupport", "documentFormatting"],
  ["$registerRangeFormattingSupport", "documentRangeFormatting"],
  ["$registerOnTypeFormattingProvider", "onTypeFormatting"],
  ["$registerRenameSupport", "rename"],
  ["$registerColorProvider", "color"],
  ["$registerFoldingRangeProvider", "foldingRange"],
  ["$registerSelectionRangeProvider", "selectionRange"],
  ["$registerDocumentSemanticTokensProvider", "semanticTokens"],
  ["$registerDocumentRangeSemanticTokensProvider", "semanticTokens"],
  ["$registerInlayHintsProvider", "inlayHint"],
  ["$registerCallHierarchyProvider", "callHierarchy"],
  ["$registerTypeHierarchyProvider", "typeHierarchy"],
  ["$registerInlineCompletionsSupport", "inlineCompletion"],
  ["$registerDocumentOnDropEditProvider", "documentDropEdit"],
  ["$registerPasteEditProvider", "documentPasteEdit"],
  ["$registerEvaluatableExpressionProvider", "evaluate"],
  ["$registerLinkedEditingRangeProvider", "linkedEditing"],
];

/** Register the actors that need real behaviour; everything else falls back. */
function registerActors(context: {
  rpc: RpcProtocol;
  protocol: ExtensionHostProtocol;
  proxies: ExtHostProxies;
  registrations: LanguageFeatureRegistration[];
  unhandled: { actor: string; method: string }[];
  markers: Map<string, unknown>;
  mirror: Map<string, MirrorEntry>;
  activated: Set<string>;
  extensions: readonly ExtensionDescription[];
  onUnhandledCall?: (call: { actor: string; method: string }) => void;
  onLog: (message: string) => void;
}): void {
  const { rpc, protocol, registrations } = context;
  const implemented = new Set<string>();
  const set = (name: string, instance: Record<string, unknown>) => {
    const identifier = protocol.MainContext[name];
    if (!identifier) throw new Error(`the build has no MainContext.${name}`);
    implemented.add(name);
    rpc.set(identifier as RpcProxyIdentifier<unknown>, instance);
  };

  // Providers: the handle is ours to keep, and the host hands it back on every
  // call. Everything else about a provider is the host's business.
  const languageFeatures: Record<string, unknown> = {
    $unregister: (handle: number) => {
      const index = registrations.findIndex((registration) => registration.handle === handle);
      if (index >= 0) registrations.splice(index, 1);
    },
  };
  for (const [method, kind] of REGISTER_METHODS) {
    languageFeatures[method] = (handle: number, selector: readonly unknown[]) => {
      registrations.push({ kind, handle, selector });
    };
  }
  set("MainThreadLanguageFeatures", languageFeatures);

  // Storage: an extension's mementos wait on this before it is allowed to
  // activate, and a missing answer reads as a failed activation.
  set("MainThreadStorage", {
    $initializeExtensionStorage: () => Promise.resolve(undefined),
    $setValue: () => Promise.resolve(),
    $registerExtensionStorageKeysToSync: () => undefined,
  });

  // Output channels: the language client asks for one during `start()` and
  // treats a missing channel as a failed start.
  let channel = 0;
  set("MainThreadOutputService", {
    $register: (label: string, _file: unknown, _languageId: unknown, extensionId: string) =>
      Promise.resolve(`extension-output-${extensionId}-#${++channel}-${label}`),
    $update: () => Promise.resolve(),
    $reveal: () => Promise.resolve(),
    $close: () => Promise.resolve(),
    $dispose: () => Promise.resolve(),
  });

  // The host's own console output arrives here (it pipes `console.*` from
  // extensions over this actor); without it, an extension that fails inside a
  // callback is silent.
  set("MainThreadConsole", {
    $logExtensionHostMessage: (message: unknown) => context.onLog(describeConsole(message)),
  });

  set("MainThreadExtensionService", {
    $getExtension: (extensionId: string) =>
      Promise.resolve(
        context.extensions.find(
          (extension) =>
            extension.identifier.value.toLowerCase() === extensionId.toLowerCase() ||
            extension.identifier._lower === extensionId.toLowerCase(),
        ),
      ),
    $activateExtension: () => Promise.resolve(),
    // Awaited by the host: resolving it is what lets an activation start.
    $onWillActivateExtension: (extensionId: { value?: string }) => {
      context.onLog(`activating ${extensionId?.value ?? "?"}`);
      return Promise.resolve();
    },
    $onDidActivateExtension: (extensionId: { value?: string }) => {
      if (extensionId?.value) context.activated.add(extensionId.value);
      return context.onLog(`activated ${extensionId?.value ?? "?"}`);
    },
    $onExtensionActivationError: (extensionId: { value?: string }, error: unknown) => {
      // Activation is over either way: what it registered is all there will be.
      if (extensionId?.value) context.activated.add(extensionId.value);
      context.onLog(`activation failed (${extensionId?.value ?? "?"}): ${describeError(error)}`);
      return Promise.resolve();
    },
    $onExtensionRuntimeError: (extensionId: { value?: string }, error: unknown) =>
      context.onLog(`runtime error (${extensionId?.value ?? "?"}): ${describeError(error)}`),
    $setPerformanceMarks: () => Promise.resolve(),
    $asBrowserUri: (uri: unknown) => Promise.resolve(uri),
  });

  // The host reads this once at start-up; `undefined` would leave it without a
  // focus state to work with.
  set("MainThreadWindow", {
    $getInitialState: () =>
      Promise.resolve({
        isFocused: true,
        isActive: true,
        activeEditorId: null,
        visibleEditorIds: [],
      }),
  });

  set("MainThreadWorkspace", {
    $startFileSearch: () => Promise.resolve(null),
    $startTextSearch: () => Promise.resolve(null),
    $checkExists: () => Promise.resolve(false),
    $save: () => Promise.resolve(undefined),
    $saveAll: () => Promise.resolve(false),
    $updateWorkspaceFolders: () => Promise.resolve(),
    $resolveProxy: () => Promise.resolve(undefined),
    $lookupAuthorization: () => Promise.resolve(undefined),
    $lookupKerberosAuthorization: () => Promise.resolve(undefined),
    $loadCertificates: () => Promise.resolve([]),
    $requestResourceTrust: () => Promise.resolve(true),
    $requestWorkspaceTrust: () => Promise.resolve(true),
    $isResourceTrusted: () => Promise.resolve(true),
    $registerEditSessionIdentityProvider: () => undefined,
    $unregisterEditSessionIdentityProvider: () => undefined,
    $registerCanonicalUriProvider: () => undefined,
    $unregisterCanonicalUriProvider: () => undefined,
    $resolveDecoding: () =>
      Promise.resolve({
        preferredEncoding: "utf8",
        guessEncoding: false,
        candidateGuessEncodings: [],
      }),
    $validateDetectedEncoding: (_resource: unknown, detected: string) => Promise.resolve(detected),
    $resolveEncoding: () => Promise.resolve({ encoding: "utf8", addBOM: false }),
  });

  // Configuration writes go nowhere here: the workspace is the file system, and
  // persisting a setting is the consumer's policy, not this package's.
  set("MainThreadConfiguration", {
    $updateConfigurationOption: () => Promise.resolve(),
    $removeConfigurationOption: () => Promise.resolve(),
  });

  // Documents the host asks to open: read from disk and push, because the
  // host's copy is the mirror we maintain.
  set("MainThreadDocuments", {
    $tryOpenDocument: async (uri: UriLike) => {
      const text = await readFile(uri.path, "utf8");
      openDocument(context.proxies, context.mirror, {
        uri,
        languageId: languageIdFor(uri),
        text,
      });
      return uri;
    },
    $tryCreateDocument: () => Promise.reject(new Error("creating documents is not supported")),
    $trySaveDocument: () => Promise.resolve(false),
  });

  set("MainThreadFileSystem", {
    $ensureActivation: () => Promise.resolve(),
    $stat: async (uri: UriLike) => {
      const info = await stat(uri.path);
      return {
        type: info.isDirectory() ? 2 : 1,
        ctime: info.ctimeMs,
        mtime: info.mtimeMs,
        size: info.size,
      };
    },
    $readdir: (uri: UriLike) => readdir(uri.path),
    $readFile: async (uri: UriLike) => new Uint8Array(await readFile(uri.path)),
    $writeFile: async (uri: UriLike, content: Uint8Array) => {
      await mkdir(dirname(uri.path), { recursive: true });
      await writeFile(uri.path, content);
    },
    $mkdir: (uri: UriLike) => mkdir(uri.path, { recursive: true }).then(() => undefined),
    $delete: (uri: UriLike, options?: { recursive?: boolean }) =>
      rm(uri.path, { recursive: options?.recursive ?? false, force: true }),
    $rename: (from: UriLike, to: UriLike) => rename(from.path, to.path),
    $copy: async (from: UriLike, to: UriLike) => {
      await mkdir(dirname(to.path), { recursive: true });
      await writeFile(to.path, await readFile(from.path));
    },
  });

  // Markers: kept so a consumer can see what an extension reported without
  // implementing a problems view.
  set("MainThreadDiagnostics", {
    $changeMany: (owner: string, entries: [UriLike, unknown][]) =>
      context.markers.set(owner, entries),
    $clear: (owner: string) => context.markers.delete(owner),
  });

  // Everything else answers `undefined` and is recorded: a gap should read as a
  // missing feature, not as an extension host that will not start.
  for (const [name, identifier] of Object.entries(protocol.MainContext)) {
    if (implemented.has(name)) continue;
    rpc.set(identifier as RpcProxyIdentifier<unknown>, fallbackActor(name, context));
  }
}

/** Guess a language from a file name; the host's own language list is empty. */
function languageIdFor(uri: UriLike): string {
  const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return extension === "css" || extension === "scss" || extension === "less" ? extension : "";
}

function fallbackActor(
  name: string,
  context: {
    unhandled: { actor: string; method: string }[];
    onUnhandledCall?: (call: { actor: string; method: string }) => void;
  },
): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== "string" || !property.startsWith("$")) return undefined;
        return (..._args: unknown[]) => {
          context.unhandled.push({ actor: name, method: property });
          context.onUnhandledCall?.({ actor: name, method: property });
          return undefined;
        };
      },
    },
  );
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

/** Flatten the host's `IRemoteConsoleLog` into one line. */
function describeConsole(message: unknown): string {
  const entry = message as { type?: string; severity?: string; arguments?: unknown } | undefined;
  const text =
    typeof entry?.arguments === "string"
      ? entry.arguments
      : entry?.arguments === undefined
        ? ""
        : JSON.stringify(entry.arguments);
  return `${entry?.severity ?? entry?.type ?? "log"}: ${text}`;
}
