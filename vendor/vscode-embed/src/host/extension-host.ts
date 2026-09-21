/**
 * Running a VS Code **extension host** as a child process of ours, and speaking
 * the extension host protocol to it — the end upstream calls the *main thread*.
 *
 * Mechanism only. **Which** extensions exist, what the workspace is, where
 * storage lives and what happens to the host's output stay with the consumer —
 * this package knows nothing about the app it is embedded into, and nothing
 * about DSH. What lives here is the part that has to agree with the build
 * byte-for-byte: the carrier, the handshake, and the RPC layer on top of it.
 *
 * Why fork it ourselves rather than let the code server do it: the ecosystem
 * must be reachable with no page open (upstream starts a host only when a
 * renderer asks for one), and the protocol below is transport-agnostic, so the
 * same code works against a local pipe or a socket.
 *
 * The three facts this module exists to encode, each learned from the running
 * build rather than from documentation:
 *
 * 1. the entry is `bootstrap-fork.js` plus `VSCODE_ESM_ENTRYPOINT`, not the
 *    bundled `extensionHostProcess.js` directly;
 * 2. the bundled host loads its localised message table **during module
 *    evaluation**, so `VSCODE_NLS_CONFIG` has to travel in the environment or
 *    the host dies before it connects;
 * 3. the wire order is fixed — the host sends `Ready`, we answer with one JSON
 *    frame of init data, it answers `Initialized`; anything else on that socket
 *    before init data is parsed as JSON and kills it.
 *
 * @module prac-vscode-embed/host/extension-host
 */

import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The module `bootstrap-fork.js` is told to load, via `VSCODE_ESM_ENTRYPOINT`. */
export const EXTENSION_HOST_ENTRYPOINT = "vs/workbench/api/node/extensionHostProcess";

/** Where a build recipe conventionally leaves the fork entry, under a repo root. */
export const BOOTSTRAP_RELATIVE_PATH = join(
  ".build",
  "vscode",
  "out-vscode-reh",
  "bootstrap-fork.js",
);

/**
 * The single-byte control frames exchanged before the RPC layer is up.
 *
 * `extensionHostProtocol.ts` counts from zero (`Initialized = 0`), but
 * `createMessageOfType` writes `type + 1`, so these are the bytes actually seen
 * on the socket.
 */
const FRAME_INITIALIZED = 1;
const FRAME_READY = 2;

/** How long the host gets to say `Ready` + accept init data before we give up. */
const HANDSHAKE_TIMEOUT_MS = 30_000;

/** A service locator in the extension host protocol. */
export interface RpcProxyIdentifier<T> {
  /** Human-readable name, used in logs and in `Unknown actor` errors. */
  readonly sid: string;
  /** The number that actually travels on the wire (a `UInt8`). */
  readonly nid: number;
  readonly _brand?: T;
}

/** The RPC layer, as much of it as a consumer of this module needs. */
export interface RpcProtocol {
  /** Register our implementation of a service the host will call. */
  set(identifier: RpcProxyIdentifier<unknown>, instance: unknown): void;
  /** Reach a service the host registered (`ExtHostContext.…`). */
  getProxy(identifier: RpcProxyIdentifier<unknown>): unknown;
  dispose(): void;
}

/** The protocol tables, straight from the build we are talking to. */
export interface ExtensionHostProtocol {
  /** Services we implement (`MainThreadXxx`). */
  readonly MainContext: Readonly<Record<string, RpcProxyIdentifier<unknown>>>;
  /** Services the host implements (`ExtHostXxx`). */
  readonly ExtHostContext: Readonly<Record<string, RpcProxyIdentifier<unknown>>>;
}

export interface ExtensionHostLocationOptions {
  /** Directory the upward search starts from — normally the consumer's own directory. */
  readonly from: string;
  /** Explicit path to `bootstrap-fork.js`; wins over the search. */
  readonly override?: string;
}

/** Where the pieces this mechanism needs sit in a checkout. */
export interface ExtensionHostLocation {
  /** Absolute path of `bootstrap-fork.js`. */
  readonly bootstrap: string;
  /**
   * The checkout root (`…/vscode`). Both the fork's cwd and the root the
   * protocol modules are resolved from.
   */
  readonly checkoutRoot: string;
  /** `<checkout>/out-vscode-reh`, where the localised message table lives. */
  readonly rehRoot: string;
  /** `<checkout>/out-build`, the unpacked build the protocol modules come from. */
  readonly outBuild: string;
  /** `version` / `quality` / `commit` as the build recorded them. */
  readonly product: {
    readonly version?: string;
    readonly quality?: string;
    readonly commit?: string;
  };
}

/**
 * Find the built extension host by walking up from `from`.
 *
 * Like {@link resolveCodeServer}, the conventional path is returned even when
 * nothing is on disk, so a missing build reads as a missing build rather than as
 * a wrong root.
 */
export function resolveExtensionHost(options: ExtensionHostLocationOptions): ExtensionHostLocation {
  const bootstrap = options.override
    ? resolve(options.override)
    : searchUp(resolve(options.from), BOOTSTRAP_RELATIVE_PATH);
  const rehRoot = dirname(bootstrap);
  const checkoutRoot = resolve(rehRoot, "..");
  return {
    bootstrap,
    checkoutRoot,
    rehRoot,
    outBuild: join(checkoutRoot, "out-build"),
    product: readProduct(checkoutRoot),
  };
}

function searchUp(from: string, relative: string): string {
  let dir = from;
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from, "..", relative);
}

function readProduct(checkoutRoot: string): ExtensionHostLocation["product"] {
  try {
    const raw = JSON.parse(readFileSync(join(checkoutRoot, "product.json"), "utf8")) as {
      version?: string;
      quality?: string;
      commit?: string;
    };
    return { version: raw.version, quality: raw.quality, commit: raw.commit };
  } catch {
    return {};
  }
}

/**
 * The environment the host process is started with.
 *
 * `VSCODE_NLS_CONFIG` is not optional here: the bundled host resolves its
 * message table while its modules are evaluated, and without the table it throws
 * `NLS MISSING` before it ever connects.
 */
export function extensionHostEnv(
  location: ExtensionHostLocation,
  pipePath: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    VSCODE_ESM_ENTRYPOINT: EXTENSION_HOST_ENTRYPOINT,
    VSCODE_EXTHOST_IPC_HOOK: pipePath,
    VSCODE_HANDLES_UNCAUGHT_ERRORS: "true",
    VSCODE_NLS_CONFIG: JSON.stringify({
      resolvedLanguage: "en",
      defaultMessagesFile: join(location.rehRoot, "nls.messages.json"),
    }),
  };
}

/** A URI in the shape the protocol's `UriComponents` uses. */
export interface UriLike {
  readonly scheme: string;
  readonly path: string;
}

/** What the consumer decides about the host: everything policy-shaped. */
export interface ExtensionHostInitDataInput {
  readonly environment: {
    readonly appName: string;
    readonly appHost: string;
    readonly appLanguage: string;
    readonly appUriScheme: string;
    readonly globalStorageHome: UriLike;
    readonly workspaceStorageHome: UriLike;
  };
  /** The workspace the host should believe it is in; `null` is a valid answer. */
  readonly workspace?: Record<string, unknown> | null;
  /** Which extensions exist, what activates them, and which of them are ours. */
  readonly extensions: {
    readonly versionId: number;
    readonly allExtensions: readonly unknown[];
    readonly activationEvents: Readonly<Record<string, readonly string[]>>;
    readonly myExtensions: readonly unknown[];
  };
  readonly telemetryInfo: {
    readonly sessionId: string;
    readonly machineId: string;
    readonly sqmId: string;
    readonly devDeviceId: string;
    readonly firstSessionDate: string;
  };
  readonly logLevel?: number;
  readonly loggers?: readonly unknown[];
  /** Let the host start itself once initialised. Defaults to `true`. */
  readonly autoStart?: boolean;
  /**
   * Poll for this process still being alive and exit with it. Defaults to the
   * current pid; `0` turns the watchdog off (which is what a test wants).
   */
  readonly parentPid?: number;
}

/**
 * The full init data frame: the consumer's policy plus the fields that have to
 * match the build (version, quality, commit) or the protocol (remote shape,
 * console forwarding, UI kind).
 */
export function extensionHostInitData(
  location: ExtensionHostLocation,
  input: ExtensionHostInitDataInput,
): Record<string, unknown> {
  return {
    version: location.product.version ?? "0.0.0",
    quality: location.product.quality,
    // Matching the build's own commit lets the host's version check pass, and
    // keeps it as a real check: a mismatched pair fails loudly instead of
    // silently skipping the comparison.
    commit: location.product.commit,
    date: new Date().toISOString(),
    parentPid: input.parentPid ?? process.pid,
    environment: input.environment,
    workspace: input.workspace ?? null,
    extensions: input.extensions,
    telemetryInfo: input.telemetryInfo,
    logLevel: input.logLevel ?? 3,
    loggers: input.loggers ?? [],
    logsLocation: input.environment.globalStorageHome,
    autoStart: input.autoStart ?? true,
    remote: { isRemote: false, authority: undefined, connectionData: null },
    consoleForward: { includeStack: false, logNative: false },
    uiKind: 1,
  };
}

/** One message on the wire, as much of the buffer as this module touches. */
interface Message {
  readonly buffer: Uint8Array;
}

/** The subset of `PersistentProtocol` this module uses. */
interface MessagePassingProtocol {
  onMessage(listener: (message: Message) => void): { dispose(): void };
  send(message: { buffer: Uint8Array }): void;
  sendResume(): void;
}

/**
 * Our end of the connection, from the first byte onwards.
 *
 * The host starts sending RPC the instant it has accepted init data, which is
 * *before* the RPC layer exists on our side — and a lost frame is not a lost
 * log line here, it is a call the host is awaiting a reply to. So everything
 * that arrives is queued until the RPC layer subscribes, and the control frames
 * of the handshake are taken out of that same queue in order.
 */
class ConnectionProtocol implements MessagePassingProtocol {
  private readonly pending: Message[] = [];
  private readonly subscription: { dispose(): void };
  private listener: ((message: Message) => void) | undefined;
  private waiter: ((message: Message) => void) | undefined;
  private released = false;

  constructor(private readonly raw: MessagePassingProtocol) {
    this.subscription = raw.onMessage((message) => this.push(message));
  }

  onMessage(listener: (message: Message) => void): { dispose(): void } {
    this.listener = listener;
    if (this.released) this.flush();
    return {
      dispose: () => {
        if (this.listener === listener) this.listener = undefined;
      },
    };
  }

  send(message: { buffer: Uint8Array }): void {
    this.raw.send(message);
  }

  sendResume(): void {
    this.raw.sendResume();
  }

  /** Take the next inbound message, queued or still to arrive. */
  next(timeoutMs: number, describeWait: string): Promise<Message> {
    const queued = this.pending.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<Message>((resolveNext, rejectNext) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        rejectNext(new Error(`extension host did not send ${describeWait} in time`));
      }, timeoutMs);
      this.waiter = (message) => {
        clearTimeout(timer);
        resolveNext(message);
      };
    });
  }

  /**
   * Start delivering to the RPC layer.
   *
   * Deliberately a separate step from subscribing: the host's first frames are
   * calls into actors *we* have to have registered by then, and an unregistered
   * actor is answered with `Unknown actor` — a lost call, not a lost log line.
   */
  release(): void {
    this.released = true;
    this.flush();
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private flush(): void {
    if (!this.listener) return;
    for (const message of this.pending.splice(0)) this.listener(message);
  }

  private push(message: Message): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter(message);
      return;
    }
    // Delivering straight through once released keeps ordering; the queue is
    // only for the window before that.
    if (this.released && this.listener) this.listener(message);
    else this.pending.push(message);
  }
}

export interface StartExtensionHostOptions {
  /** Where the build is (see {@link resolveExtensionHost}). */
  readonly location: ExtensionHostLocation;
  /** Everything policy-shaped about the host (see {@link extensionHostInitData}). */
  readonly initData: ExtensionHostInitDataInput;
  /** Called with the child's stdout/stderr; the consumer decides where it goes. */
  readonly onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  /**
   * Register `MainThread*` implementations **before** the host's first frames
   * are dispatched.
   *
   * The host starts calling us the moment it accepts init data — start-up
   * bookkeeping included — and a call to an unregistered actor is answered with
   * `Unknown actor`, which the host sees as a failed call rather than as a
   * missing feature. Frames that arrive before this hook runs are queued, so
   * registering here is enough.
   */
  readonly configure?: (connection: {
    readonly rpc: RpcProtocol;
    readonly protocol: ExtensionHostProtocol;
  }) => void;
}

/** A running extension host and our end of the protocol. */
export interface ExtensionHostHandle {
  /** Our end of the RPC: register `MainThread*` implementations, reach `ExtHost*`. */
  readonly rpc: RpcProtocol;
  /** The protocol tables of the build we are connected to. */
  readonly protocol: ExtensionHostProtocol;
  /** The exact frame that was handed over (useful for logs and for tests). */
  readonly initData: Record<string, unknown>;
  /** The host process, for logging and for a caller that wants to watch it. */
  readonly child: ChildProcess;
  /** Stop the host and release the pipe. */
  dispose(): Promise<void>;
}

/**
 * Start an extension host and complete the handshake.
 *
 * Rejects — and takes the child down — when the host does not say `Ready` and
 * accept init data within {@link HANDSHAKE_TIMEOUT_MS}, or when the build's
 * protocol modules cannot be loaded.
 */
export async function startExtensionHost(
  options: StartExtensionHostOptions,
): Promise<ExtensionHostHandle> {
  const { location } = options;
  const modules = await loadProtocolModules(location);
  const directory = mkdtempSync(join(tmpdir(), "prac-exthost-"));
  const pipePath = join(directory, "exthost.sock");
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(pipePath, resolveListen);
  });

  const child = fork(location.bootstrap, [], {
    cwd: location.checkoutRoot,
    env: extensionHostEnv(location, pipePath),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk: Buffer) => options.onOutput?.("stdout", chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => options.onOutput?.("stderr", chunk.toString()));

  const close = () => {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  };

  let socket: Socket | undefined;
  try {
    socket = await acceptConnection(server, child);
    const connection = await handshake(socket, location, options.initData);
    const rpc = new modules.RPCProtocol(connection);
    const protocol: ExtensionHostProtocol = {
      MainContext: modules.MainContext,
      ExtHostContext: modules.ExtHostContext,
    };
    // The consumer's actors go in before the queued frames are released: see
    // StartExtensionHostOptions.configure.
    options.configure?.({ rpc, protocol });
    connection.release();
    let disposed = false;
    return {
      rpc,
      protocol,
      initData: extensionHostInitData(location, options.initData),
      child,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        // No draining: we are taking the host down, and upstream's drain waits
        // on acknowledgements that a killed peer never sends.
        rpc.dispose();
        connection.dispose();
        socket?.destroy();
        child.kill();
        close();
      },
    };
  } catch (error) {
    socket?.destroy();
    child.kill();
    close();
    throw error;
  }
}

/** Wait for the host to connect to the pipe, or for it to die trying. */
async function acceptConnection(server: Server, child: ChildProcess): Promise<Socket> {
  return new Promise<Socket>((resolveConnection, rejectConnection) => {
    const timer = setTimeout(
      () => rejectConnection(new Error("extension host did not connect in time")),
      HANDSHAKE_TIMEOUT_MS,
    );
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    server.once("connection", (socket) => settle(() => resolveConnection(socket)));
    child.once("exit", (code, signal) =>
      settle(() =>
        rejectConnection(
          new Error(`extension host exited before connecting (code ${code}, ${signal})`),
        ),
      ),
    );
  });
}

/**
 * Talk the fixed pre-RPC sequence: `Ready` in, one JSON init-data frame out,
 * `Initialized` in — and return the connection with everything that arrived
 * meanwhile still queued, so handing it to the RPC layer loses nothing.
 */
async function handshake(
  socket: Socket,
  location: ExtensionHostLocation,
  initData: ExtensionHostInitDataInput,
): Promise<ConnectionProtocol> {
  const { NodeSocket } = await import(
    pathToFileURL(join(location.outBuild, "vs/base/parts/ipc/node/ipc.net.js")).href
  );
  const { PersistentProtocol } = await import(
    pathToFileURL(join(location.outBuild, "vs/base/parts/ipc/common/ipc.net.js")).href
  );
  const { VSBuffer } = await import(
    pathToFileURL(join(location.outBuild, "vs/base/common/buffer.js")).href
  );

  const raw = new PersistentProtocol({
    socket: new NodeSocket(socket, "renderer-extHost"),
  }) as MessagePassingProtocol;
  const connection = new ConnectionProtocol(raw);
  raw.sendResume();

  await expectFrame(connection, FRAME_READY, "ready");
  connection.send(VSBuffer.fromString(JSON.stringify(extensionHostInitData(location, initData))));
  await expectFrame(connection, FRAME_INITIALIZED, "initialized");
  return connection;
}

/** Wait for one control frame, refusing anything that is not the expected one. */
async function expectFrame(
  connection: ConnectionProtocol,
  expected: number,
  name: string,
): Promise<void> {
  const message = await connection.next(HANDSHAKE_TIMEOUT_MS, name);
  const bytes = [...message.buffer];
  if (bytes.length !== 1 || bytes[0] !== expected) {
    throw new Error(`expected ${name} from the extension host, got [${bytes.join(", ")}]`);
  }
}

/**
 * Load the protocol modules out of the unpacked build.
 *
 * They are upstream's compiled ESM, shipped without declarations, so they are
 * typed structurally here. Three globals have to exist before they are
 * evaluated — upstream's `product` and `network` modules read them at module
 * scope — which is also why this runs once per process.
 */
async function loadProtocolModules(location: ExtensionHostLocation): Promise<{
  RPCProtocol: new (protocol: MessagePassingProtocol) => RpcProtocol;
  MainContext: Record<string, RpcProxyIdentifier<unknown>>;
  ExtHostContext: Record<string, RpcProxyIdentifier<unknown>>;
}> {
  const globals = globalThis as Record<string, unknown>;
  globals._VSCODE_PRODUCT_JSON ??= JSON.parse(
    readFileSync(join(location.checkoutRoot, "product.json"), "utf8"),
  );
  globals._VSCODE_PACKAGE_JSON ??= JSON.parse(
    readFileSync(join(location.checkoutRoot, "package.json"), "utf8"),
  );
  globals._VSCODE_FILE_ROOT ??= `${pathToFileURL(location.checkoutRoot).href}/`;

  const rpc = await import(
    pathToFileURL(join(location.outBuild, "vs/workbench/services/extensions/common/rpcProtocol.js"))
      .href
  );
  const identifiers = await import(
    pathToFileURL(join(location.outBuild, "vs/workbench/api/common/extHost.protocol.js")).href
  );
  return {
    RPCProtocol: rpc.RPCProtocol,
    MainContext: identifiers.MainContext,
    ExtHostContext: identifiers.ExtHostContext,
  };
}
