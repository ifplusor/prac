/**
 * prac's policy for the VS Code **extension host**, and the place where the two
 * ecosystems meet: VS Code's language providers on one side, DSH's `ctx.lsp`
 * seam on the other.
 *
 * The mechanism — finding the build, forking the host, the handshake, the RPC
 * layer, the minimum main thread — is `prac-vscode-embed`. What is prac's, and
 * therefore lives here:
 *
 * - **which extensions** the host gets: the built-ins the checkout ships and
 *   whatever is installed in the code server's extensions directory;
 * - **which workspace** it believes it is in: the one the query came from, so
 *   the language server the extension starts has the right root;
 * - **which documents** it sees: the file being asked about, read from disk at
 *   that moment — disk is the truth, so no buffer sync is involved;
 * - **the translation** into the seam's four operations, and the `id` and
 *   extension map the seam routes on.
 *
 * Runtime note: `@deepseek-ai/dsh-lsp` is intentionally **not** bundled; like
 * `@deepseek-ai/cordis` it resolves at runtime from the DSH installation.
 *
 * @module prac-host-vscode/language
 */

import type { Context } from "@deepseek-ai/cordis";
import { LspError, LspProviderId } from "@deepseek-ai/dsh-lsp";
import type { LspProvider, LspProviderQuery, LspQueryResult } from "@deepseek-ai/dsh-lsp";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveExtensionHost,
  scanExtensions,
  startMainThread,
  type ExtensionDescription,
  type ExtensionHostLocation,
  type LanguageFeatureKind,
  type LanguageFeatureRegistration,
  type MainThreadHandle,
  type ProviderPosition,
  type UriLike,
} from "prac-vscode-embed";

/** The plugin name used by loader diagnostics. */
const name = "prac-host-vscode";

/**
 * The provider id this package registers. Unique across providers, since a
 * second one claiming it would be refused — and an id is what an operator sees
 * when two of them disagree about a file extension.
 */
const PROVIDER_ID = "vscode-language-features";

/**
 * Which languages the VS Code built-ins can answer for. Only what the first
 * chain was verified with: claiming more would route files to a provider that
 * has nothing registered for them.
 */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
};

/** The seam's operations, and the kind of provider each one calls. */
const OPERATION_KINDS: Readonly<Record<string, LanguageFeatureKind>> = {
  hover: "hover",
  goToDefinition: "definition",
  findReferences: "references",
  goToImplementation: "implementation",
};

/**
 * `LspError` with its constructor visible.
 *
 * The published declaration of `LspError` is empty — the base class it inherits
 * from is not part of this package's types — so TypeScript sees a zero-argument
 * constructor while the runtime signature is `(message, code)`. The cast is the
 * price of keeping the seam's structured code, which is what a caller routes on
 * instead of the message.
 */
const LspFailure = LspError as unknown as new (message: string, code: string) => Error;

/** How long an activation gets to produce the registration a query needs. */
const REGISTRATION_TIMEOUT_MS = 30_000;

export interface LanguageFeaturesOptions {
  /** The checkout the built-in extensions come from (`…/.build/vscode`). */
  readonly checkoutRoot: string;
  /** Where installed extensions live (`--extensions-dir`). */
  readonly userExtensionsDir: string;
  /** Root for the host's own storage (`globalStorage` / `workspaceStorage`). */
  readonly storageRoot: string;
}

/**
 * Register the extension-host provider with the seam, and own the host's
 * lifetime.
 *
 * Injected lazily on `lsp`: a profile without the seam composes exactly as it
 * did before, and nothing is forked until someone asks a language question.
 */
export function manageLanguageFeatures(ctx: Context, options: LanguageFeaturesOptions): void {
  const hosts = new ExtensionHosts(options);
  ctx.inject(["lsp"], (lspCtx) => {
    lspCtx.effect(() => {
      const dispose = lspCtx.lsp.registerProvider(createProvider(hosts));
      console.log(
        `${name}: lsp provider ${PROVIDER_ID} registered for ${Object.keys(EXTENSION_TO_LANGUAGE).join(", ")}`,
      );
      return dispose;
    }, `${name}: lsp provider (${PROVIDER_ID})`);
    lspCtx.effect(() => () => void hosts.dispose(), `${name}: extension host`);
  });
}

function createProvider(hosts: ExtensionHosts): LspProvider {
  return {
    id: LspProviderId(PROVIDER_ID),
    extensionToLanguage: EXTENSION_TO_LANGUAGE,
    query: (request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> =>
      query(hosts, request, signal),
  };
}

/**
 * One host per workspace root.
 *
 * A language server is started with a root, and an extension host is the thing
 * that starts it: switching workspaces therefore means a new host, not a new
 * argument. Only one is kept — the agent works in one workspace at a time, and
 * keeping the previous one alive would keep its language server alive too.
 */
class ExtensionHosts {
  private current: { readonly root: string; readonly host: Promise<MainThreadHandle> } | undefined;
  private extensions: readonly ExtensionDescription[] = [];
  private scannedAt = 0;

  /** How long a scan is trusted before the directories are read again. */
  private static readonly RESCAN_AFTER_MS = 2_000;

  constructor(private readonly options: LanguageFeaturesOptions) {}

  /**
   * Re-read the extension directories and tell a running host what changed.
   *
   * Extensions appear while the host is up — that is the normal case for a
   * user-installed extension — and VS Code's answer is a registry delta rather
   * than a restart, because a restart would throw away the language servers the
   * running extensions already started. Throttled: a scan reads a manifest per
   * directory, so it is not worth doing on every question.
   */
  async refresh(): Promise<void> {
    if (Date.now() - this.scannedAt < ExtensionHosts.RESCAN_AFTER_MS) return;
    const scanned = this.scan();
    this.scannedAt = Date.now();
    const current = this.current;
    if (!current) {
      this.extensions = scanned;
      return;
    }
    const host = await current.host;
    await host.setExtensions(scanned);
    this.extensions = scanned;
  }

  private scan(): ExtensionDescription[] {
    return scanExtensions({
      builtinDir: join(this.options.checkoutRoot, "extensions"),
      userDir: this.options.userExtensionsDir,
    });
  }

  /**
   * The extensions that say they activate for a language.
   *
   * Used to tell "the provider is on its way" apart from "no one provides
   * this": once all of these have finished activating and the provider is still
   * absent, more waiting cannot change the answer. The generic `onLanguage`
   * event counts, because an extension that activates on it may well provide
   * for this language.
   */
  candidatesFor(languageId: string): readonly string[] {
    return this.extensions
      .filter((extension) => {
        const events = extension.activationEvents ?? [];
        return events.some(
          (event) =>
            event === `onLanguage:${languageId}` || event === "onLanguage" || event === "*",
        );
      })
      .map((extension) => extension.identifier.value);
  }

  async for(workspaceRoot: string): Promise<MainThreadHandle> {
    if (this.current?.root === workspaceRoot) return this.current.host;
    await this.dispose();
    const host = this.start(workspaceRoot).catch((error: unknown) => {
      // A failed start must not be remembered: the next query retries, which is
      // what a build that appears later needs.
      this.current = undefined;
      throw error;
    });
    this.current = { root: workspaceRoot, host };
    return host;
  }

  async dispose(): Promise<void> {
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    try {
      await (await current.host).dispose();
    } catch {
      // Already gone: disposing a host that failed to start is not an error.
    }
  }

  private async start(workspaceRoot: string): Promise<MainThreadHandle> {
    const location = this.location();
    const extensions = this.scan();
    this.extensions = extensions;
    this.scannedAt = Date.now();
    console.log(
      `${name}: starting the extension host for ${workspaceRoot} with ${extensions.length} extension(s)`,
    );
    return startMainThread({
      location,
      policy: {
        environment: {
          appName: "prac",
          appHost: "node",
          appUriScheme: "prac",
          // Localisation stays out of the picture: with `en` the host never
          // asks for a language bundle during extension activation.
          appLanguage: "en",
          globalStorageHome: {
            scheme: "file",
            path: join(this.options.storageRoot, "globalStorage"),
          },
          workspaceStorageHome: {
            scheme: "file",
            path: join(this.options.storageRoot, "workspaceStorage"),
          },
          telemetry: {
            sessionId: "prac",
            machineId: "prac",
            sqmId: "",
            devDeviceId: "prac",
            firstSessionDate: new Date().toISOString(),
          },
        },
        extensions,
        workspace: {
          id: workspaceRoot,
          name: basename(workspaceRoot) || workspaceRoot,
          folders: [
            {
              uri: { scheme: "file", path: workspaceRoot },
              name: basename(workspaceRoot),
              index: 0,
            },
          ],
        },
        onLog: (message) => console.log(`${name}: extension host | ${message}`),
        onUnhandledCall: ({ actor, method }) =>
          console.log(`${name}: extension host asked for ${actor}.${method} (not implemented)`),
      },
      onOutput: (stream, chunk) => {
        const write = stream === "stderr" ? console.warn : console.log;
        write(`${name}: extension host | ${chunk.trimEnd()}`);
      },
    });
  }

  private location(): ExtensionHostLocation {
    return resolveExtensionHost({ from: fileURLToPath(new URL(".", import.meta.url)) });
  }
}

/** The seam's question, answered by the extension host. */
async function query(
  hosts: ExtensionHosts,
  request: LspProviderQuery,
  signal: AbortSignal | undefined,
): Promise<LspQueryResult> {
  const kind = OPERATION_KINDS[request.operation];
  if (kind === undefined) {
    throw new LspFailure(
      `operation ${request.operation} is not implemented`,
      "LSP_UNSUPPORTED_OPERATION",
    );
  }
  // An extension may have appeared since the last look, so the directories are
  // re-read (throttled) before we ask the host to activate anything.
  await hosts.refresh();
  const host = await hosts.for(request.workspaceRoot);
  const uri: UriLike = { scheme: "file", path: request.filePath };
  // Disk is the truth (the workspace contract): the host gets what is on disk
  // now, not a buffer we would have to keep in sync.
  const text = await readFile(request.filePath, "utf8");
  host.openDocument({ uri, languageId: request.languageId, text });
  // The same pair VS Code's own language service fires when a document needs
  // rich features: the specific event, and the generic one.
  await host.activateByEvent(`onLanguage:${request.languageId}`);
  await host.activateByEvent("onLanguage");
  const registration = await registrationFor(
    host,
    kind,
    request.languageId,
    request.filePath,
    hosts.candidatesFor(request.languageId),
  );
  const position: ProviderPosition = {
    line: request.position.line,
    character: request.position.character,
  };

  if (kind === "hover") {
    const hover = await host.provideHover(registration.handle, uri, position, signal);
    return { kind: "hover", hover };
  }
  const locations =
    kind === "definition"
      ? await host.provideDefinition(registration.handle, uri, position, signal)
      : kind === "implementation"
        ? await host.provideImplementation(registration.handle, uri, position, signal)
        : await host.provideReferences(registration.handle, uri, position, signal);
  return {
    kind: "locations",
    locations: locations.map((location) => ({
      uri: uriToString(location.uri),
      range: location.range,
    })),
    resolvedWorkspaceUri: pathToFileURL(request.workspaceRoot).href,
  };
}

/**
 * The registration to call, waiting for the extension to get there.
 *
 * Activation is asynchronous and the registration arrives after it, so the first
 * query for a language races the extension's own start-up; waiting here is what
 * makes the first hover work rather than fail once.
 */
async function registrationFor(
  host: MainThreadHandle,
  kind: LanguageFeatureKind,
  languageId: string,
  filePath: string,
  candidates: readonly string[],
): Promise<LanguageFeatureRegistration> {
  const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
  for (;;) {
    const match = host.registrations.find(
      (registration) =>
        registration.kind === kind && matches(registration.selector, languageId, filePath),
    );
    if (match) return match;
    // Every extension that could have provided this has finished activating, so
    // the provider is not coming: say so now rather than at the timeout.
    if (candidates.length > 0 && candidates.every((id) => host.activated.has(id))) {
      throw new LspFailure(
        `the extension(s) for ${languageId} do not provide ${kind}`,
        "LSP_UNSUPPORTED_OPERATION",
      );
    }
    if (Date.now() > deadline) {
      throw new LspFailure(
        `no ${kind} provider for ${languageId} in ${filePath} after ${REGISTRATION_TIMEOUT_MS}ms`,
        "LSP_UNSUPPORTED_OPERATION",
      );
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

/**
 * Whether a document filter selects this document.
 *
 * `IDocumentFilterDto` is a language, a scheme and/or a pattern; the built-ins
 * register plain language lists, and a pattern is honoured as a suffix match so
 * a selector written for a recursive css glob still applies.
 */
function matches(selector: readonly unknown[], languageId: string, filePath: string): boolean {
  return selector.some((entry) => {
    if (typeof entry === "string") return entry === languageId || entry === "*";
    if (entry === null || typeof entry !== "object") return false;
    const filter = entry as {
      readonly language?: string;
      readonly scheme?: string;
      readonly pattern?: unknown;
    };
    if (filter.scheme !== undefined && filter.scheme !== "file" && filter.scheme !== "*")
      return false;
    if (
      filter.language !== undefined &&
      filter.language !== languageId &&
      filter.language !== "*"
    ) {
      return false;
    }
    if (filter.pattern !== undefined) {
      const pattern = typeof filter.pattern === "string" ? filter.pattern : undefined;
      if (pattern === undefined) return false;
      const suffix = pattern.replace(/^\*\*\//, "").replace(/^\*/, "");
      return filePath.endsWith(suffix);
    }
    return true;
  });
}

/** A location's URI as the seam wants it: a plain string, `file:` for local ones. */
function uriToString(uri: UriLike): string {
  const withAuthority = uri as UriLike & { readonly authority?: string };
  if (uri.scheme === "file") return pathToFileURL(uri.path).href;
  return `${uri.scheme}://${withAuthority.authority ?? ""}${uri.path}`;
}
