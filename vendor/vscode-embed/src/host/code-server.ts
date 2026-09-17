/**
 * Running a code server as a child process: which port, when it is ready, how it
 * is stopped.
 *
 * Mechanism only. **Which** server to run, **where** its state goes, whether to
 * run one at all and what to do with its output stay with the consumer — this
 * package knows nothing about the app it is embedded into, and nothing about DSH.
 * The flags that carry policy (an authentication token, for instance) travel in
 * {@link CodeServerArgvOptions.extraArgs}.
 *
 * @module prac-vscode-embed/host/code-server
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { get as httpGet } from "node:http";

/**
 * Where a build recipe conventionally leaves the server (`<checkout>/out-vscode-reh`),
 * relative to the repository root.
 */
export const SERVER_ENTRY_RELATIVE_PATH = join(
  ".build",
  "vscode",
  "out-vscode-reh",
  "server-main.js",
);

export interface CodeServerLocationOptions {
  /**
   * Directory the upward search starts from — normally the consumer's own
   * directory, the same starting point `resolveBundleRoot` is given.
   */
  readonly from: string;
  /** Explicit path to `server-main.js`; wins over the search. */
  readonly override?: string;
}

/** Where the code server's entry sits, and the directory it has to run in. */
export interface CodeServerLocation {
  /** Absolute path of `server-main.js`. */
  readonly entry: string;
  /**
   * The directory the flat `server` distro must be started from: it resolves
   * `product.json` and `node_modules` by walking up from its own script, so the
   * checkout root is the only cwd that works.
   */
  readonly cwd: string;
}

/**
 * Find the built code server by walking up from `from`.
 *
 * Returns the conventional path even when nothing is on disk: a missing build
 * then reads as a missing build ({@link codeServerLocation} callers can check
 * `existsSync`), rather than as a wrong root.
 */
export function resolveCodeServer(options: CodeServerLocationOptions): CodeServerLocation {
  if (options.override) {
    const entry = resolve(options.override);
    // `<root>/out-vscode-reh/server-main.js` ⇒ the checkout root is one level up.
    return { entry, cwd: resolve(dirname(entry), "..") };
  }
  let dir = resolve(options.from);
  for (;;) {
    const candidate = join(dir, SERVER_ENTRY_RELATIVE_PATH);
    // `<repo>/.build/vscode/out-vscode-reh/server-main.js`: the directory the
    // server must run in is the *checkout* (`<repo>/.build/vscode`), not the
    // directory the search happened to find the file under.
    if (existsSync(candidate)) return { entry: candidate, cwd: resolve(dirname(candidate), "..") };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = resolve(options.from, "..", SERVER_ENTRY_RELATIVE_PATH);
  return { entry: fallback, cwd: resolve(dirname(fallback), "..") };
}

export interface CodeServerArgvOptions {
  /** TCP port the server listens on. */
  readonly port: number;
  /** Interface to bind. Defaults to `127.0.0.1`. */
  readonly host?: string;
  /** Folder to open. Omitted means the server starts without a workspace. */
  readonly folder?: string;
  /** `--server-data-dir`: logs and workspace storage. */
  readonly serverDataDir?: string;
  /** `--extensions-dir`: where user extensions are installed. */
  readonly extensionsDir?: string;
  /** `--user-data-dir`: the user data directory. */
  readonly userDataDir?: string;
  /** Flags carrying the consumer's policy (auth, nls, …), appended verbatim. */
  readonly extraArgs?: readonly string[];
}

/**
 * The arguments after `node <entry>`.
 *
 * Pure so the flag set can be asserted; the caller decides which directories
 * exist and whether to authenticate.
 */
export function codeServerArgv(options: CodeServerArgvOptions): string[] {
  const argv = [
    "--port",
    String(options.port),
    "--host",
    options.host ?? "127.0.0.1",
    ...(options.serverDataDir ? ["--server-data-dir", options.serverDataDir] : []),
    ...(options.extensionsDir ? ["--extensions-dir", options.extensionsDir] : []),
    ...(options.userDataDir ? ["--user-data-dir", options.userDataDir] : []),
    ...(options.extraArgs ?? []),
  ];
  if (options.folder) argv.push(options.folder);
  return argv;
}

/**
 * A free TCP port on `host`.
 *
 * Bind-then-close: the OS picks, the caller uses the number. The window between
 * closing and the child binding is a race, which is why
 * {@link startCodeServer} treats "never became reachable" as a failure and
 * reports the child's output — a lost race surfaces as a loud error, not as a
 * silent misroute.
 */
export function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      probe.close(() => {
        if (port === undefined) reject(new Error("could not determine a free port"));
        else resolvePort(port);
      });
    });
  });
}

export interface WaitForReadyOptions {
  /** Give up after this long. Defaults to 20s (`server-main.js` takes seconds). */
  readonly timeoutMs?: number;
  /** Gap between attempts. Defaults to 100ms. */
  readonly intervalMs?: number;
  /** Per-attempt request timeout. Defaults to 1s. */
  readonly requestTimeoutMs?: number;
}

/** What a readiness probe needs from the server: `GET /version` answering 200. */
export function isReady(url: string, requestTimeoutMs = 1000): Promise<boolean> {
  return new Promise((ready) => {
    const request = httpGet(`${url}/version`, { timeout: requestTimeoutMs }, (response) => {
      response.resume();
      ready(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => ready(false));
  });
}

/**
 * Poll until the server answers, or reject.
 *
 * @throws when the deadline passes without a 200 — the caller adds whatever it
 * knows about the process (its output tail), which is what makes the failure
 * diagnosable rather than just slow.
 */
export async function waitForReady(url: string, options: WaitForReadyOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isReady(url, options.requestTimeoutMs)) return;
    if (Date.now() >= deadline)
      throw new Error(`${url}/version did not answer within ${timeoutMs}ms`);
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

/** How much child output is kept for the error message. */
const OUTPUT_TAIL_LINES = 40;

export interface StartCodeServerOptions extends CodeServerArgvOptions {
  /** Absolute path of the server entry (see {@link resolveCodeServer}). */
  readonly entry: string;
  /** Working directory. The flat distro needs the checkout root. */
  readonly cwd: string;
  /** A line of the child's output, as it arrives. */
  readonly onOutput?: (line: string, stream: "stdout" | "stderr") => void;
  /** The child exited on its own (a crash, or an external kill). */
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Readiness deadline; see {@link WaitForReadyOptions}. */
  readonly readyTimeoutMs?: number;
  /** How long `stop()` waits after SIGTERM before SIGKILL. Defaults to 5s. */
  readonly stopTimeoutMs?: number;
  /** Environment for the child. Defaults to the parent's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** A running code server. */
export interface CodeServerHandle {
  readonly host: string;
  readonly port: number;
  /** `http://<host>:<port>` — the origin the proxy forwards to. */
  readonly url: string;
  readonly pid: number | undefined;
  /** True once the process has exited (or {@link stop} has run). */
  readonly exited: boolean;
  /** SIGTERM, then SIGKILL after `stopTimeoutMs`. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Start a code server, wait until it answers, and hand back a handle.
 *
 * Rejects — after stopping the child — when it never becomes reachable, with the
 * child's output tail in the message.
 */
export async function startCodeServer(options: StartCodeServerOptions): Promise<CodeServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port;
  const url = `http://${host}:${port}`;
  const tail: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [options.entry, ...codeServerArgv(options)], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    options.onExit?.(code, signal);
  });

  const consume = (stream: "stdout" | "stderr", chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      tail.push(line);
      if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
      options.onOutput?.(line, stream);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => consume("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => consume("stderr", chunk));

  const stop = async (): Promise<void> => {
    if (exited) return;
    child.kill("SIGTERM");
    const stopTimeoutMs = options.stopTimeoutMs ?? 5000;
    const deadline = Date.now() + stopTimeoutMs;
    while (!exited && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    if (!exited) child.kill("SIGKILL");
  };

  try {
    await waitForReady(url, { timeoutMs: options.readyTimeoutMs });
  } catch (error) {
    await stop();
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `the code server never became reachable (${why}; exit=${exitCode ?? exitSignal ?? "none"})` +
        (tail.length ? `\n--- last output ---\n${tail.join("\n")}` : ""),
    );
  }

  return {
    host,
    port,
    url,
    pid: child.pid,
    get exited() {
      return exited;
    },
    stop,
  };
}
