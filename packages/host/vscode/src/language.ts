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
import { watch, type FSWatcher } from "node:fs";
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

/** A host for one workspace, and the extension set it was started with. */
interface Running {
  host: Promise<MainThreadHandle>;
  extensions: ExtensionDescription[];
}

/**
 * One extension host per workspace, all of them alive at once.
 *
 * A language server is started with a root, so the root is part of a host's
 * identity rather than an argument to one: two workspaces are two hosts running
 * side by side, each with its own registry and its own language servers — the
 * same shape VS Code's windows have. Work in one workspace never disturbs
 * another, and nothing is torn down because attention moved elsewhere.
 *
 * The extension directories are **watched, not polled**: installing an extension
 * writes into one of them, `fs.watch` says so, and every running host gets a
 * registry delta. The query path therefore does no scanning at all, and a
 * running host is never restarted because the set changed.
 */
class ExtensionHosts {
  private readonly running = new Map<string, Running>();
  private readonly watchers: FSWatcher[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: LanguageFeaturesOptions) {}

  /** The host for a workspace, started on first use and kept. */
  async for(workspaceRoot: string): Promise<MainThreadHandle> {
    const existing = this.running.get(workspaceRoot);
    if (existing) return existing.host;
    const extensions = this.scan();
    const entry: Running = { host: this.start(workspaceRoot, extensions), extensions };
    // A host that dies — a crash, an OOM kill, someone killing the process —
    // must not be remembered as if it were alive: sharing one host between the
    // agents of a workspace is only safe when the next question starts a fresh
    // one instead of talking to a corpse.
    entry.host = entry.host
      .then((started) => {
        started.child.once("exit", (code, signal) => {
          if (this.running.get(workspaceRoot) !== entry) return;
          this.running.delete(workspaceRoot);
          console.warn(
            `${name}: the extension host for ${workspaceRoot} exited ` +
              `(code ${code ?? "none"}, signal ${signal ?? "none"}); ` +
              `the next question starts a new one`,
          );
        });
        return started;
      })
      .catch((error: unknown) => {
        // A failed start must not be remembered either: the next query retries,
        // which is what a build that appears later needs.
        if (this.running.get(workspaceRoot) === entry) this.running.delete(workspaceRoot);
        throw error;
      });
    this.running.set(workspaceRoot, entry);
    this.watch();
    return entry.host;
  }

  /**
   * Re-read the directories and hand every running host a delta.
   *
   * Called when the directories change, and available to a caller that knows
   * something was installed without a filesystem event it can see.
   */
  async reload(): Promise<void> {
    const scanned = this.scan();
    for (const [root, entry] of this.running) {
      entry.extensions = scanned;
      try {
        if (await (await entry.host).setExtensions(scanned)) {
          console.log(`${name}: extension set changed — ${root} now has ${scanned.length}`);
        }
      } catch (error) {
        console.warn(`${name}: could not update the extension host: ${message(error)}`);
      }
    }
  }

  /**
   * The extensions that say they activate for a language in this workspace.
   *
   * Used to tell "the provider is on its way" apart from "no one provides
   * this": once all of these have finished activating and the provider is still
   * absent, more waiting cannot change the answer. The generic `onLanguage`
   * event counts, because an extension that activates on it may well provide
   * for this language.
   */
  candidatesFor(workspaceRoot: string, languageId: string): readonly string[] {
    const extensions = this.running.get(workspaceRoot)?.extensions ?? [];
    return extensions
      .filter((extension) => {
        const events = extension.activationEvents ?? [];
        return events.some(
          (event) =>
            event === `onLanguage:${languageId}` || event === "onLanguage" || event === "*",
        );
      })
      .map((extension) => extension.identifier.value);
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer !== undefined) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    for (const watcher of this.watchers.splice(0)) watcher.close();
    const entries = [...this.running.values()];
    this.running.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await (await entry.host).dispose();
        } catch {
          // Already gone: disposing a host that failed to start is not an error.
        }
      }),
    );
  }

  private scan(): ExtensionDescription[] {
    return scanExtensions({
      builtinDir: join(this.options.checkoutRoot, "extensions"),
      userDir: this.options.userExtensionsDir,
    });
  }

  /** Watch where extensions land, once, when the first host starts. */
  private watch(): void {
    if (this.watchers.length > 0) return;
    for (const directory of [
      this.options.userExtensionsDir,
      join(this.options.checkoutRoot, "extensions"),
    ]) {
      try {
        this.watchers.push(watch(directory, () => this.scheduleReload()));
      } catch (error) {
        // A directory that does not exist yet (nothing installed) is not a
        // failure: the explicit `reload()` still covers that case.
        console.warn(`${name}: not watching ${directory} for extensions: ${message(error)}`);
      }
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer !== undefined) clearTimeout(this.reloadTimer);
    // Installing an extension writes several files; one reload after the dust
    // settles is enough, and the timer must not hold a one-shot process open.
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload();
    }, 500);
    this.reloadTimer.unref();
  }

  private async start(
    workspaceRoot: string,
    extensions: readonly ExtensionDescription[],
  ): Promise<MainThreadHandle> {
    const location = this.location();
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
  // The host for this workspace, started on first use and kept: nothing is
  // scanned here — the extension directories are watched, so a change arrives
  // as a registry delta rather than as work on the query path.
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
    hosts.candidatesFor(request.workspaceRoot, request.languageId),
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

/** An error's message, for a log line that must never throw on its own. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
