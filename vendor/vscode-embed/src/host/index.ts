/**
 * prac-vscode-embed — host half.
 *
 * The mechanism for putting a built Code - OSS web bundle behind an origin the
 * embedding page can use, and for reaching the code server that bundle talks to:
 *
 * 1. **assets** — a prefix handler that serves the bundle's files with the media
 *    types a browser needs (`vs/…`, `nls.messages.js`, fonts, wasm);
 * 2. **the server channels** — the code server answers on WebSocket (management
 *    + extension host) and plain HTTP (remote resources). WebSocket is not
 *    subject to CORS, so the page can reach it directly; HTTP is, so it has to be
 *    proxied through the embedding origin.
 *
 * Everything is a parameter here. Which route, which port, which origin and where
 * the bundle lives are the consumer's policy — this package knows nothing about
 * the app it is embedded into, and nothing about DSH.
 *
 * @module prac-vscode-embed/host
 */

import { request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/** Media types a Code - OSS web bundle needs; unknown extensions are octet-stream. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
  ".scm": "text/plain; charset=utf-8",
};

/** Where a build recipe conventionally leaves the web bundle, under a repo root. */
export const BUNDLE_RELATIVE_PATH = join(".build", "vscode", "upstream", "out-vscode-web");

/** A minimal view of an HTTP response, so callers need not share a server's types. */
interface Response {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: unknown): void;
}

export interface BundleRootOptions {
  /**
   * Directory the upward search starts from — normally the consumer's own
   * directory (`fileURLToPath(new URL(".", import.meta.url))`).
   *
   * Walking up from a directory rather than counting `../` segments is
   * deliberate: the served root has moved between packages before, and a
   * miscounted segment fails as a silent 404 on every asset instead of as an
   * error.
   */
  readonly from: string;
  /** Explicit root; wins over the search. */
  readonly override?: string;
  /** Bundle location relative to the repository root. Defaults to {@link BUNDLE_RELATIVE_PATH}. */
  readonly relative?: string;
}

/**
 * Find the built bundle root by walking up from `from`.
 *
 * Without an `override`, and with nothing on disk, the path the consumer is
 * *supposed* to serve is returned rather than `undefined`: a missing build then
 * reads as a missing build (404s from a real path) rather than as a wrong root.
 */
export function resolveBundleRoot(options: BundleRootOptions): string {
  const relative = options.relative ?? BUNDLE_RELATIVE_PATH;
  if (options.override) return resolve(options.override);
  let dir = resolve(options.from);
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(options.from, "..", relative);
}

export interface CodeServerSegmentOptions {
  /** The bundle root (`…/upstream/out-vscode-web`) or the checkout root itself. */
  readonly distRoot: string;
  /** Explicit segment, with or without a leading slash; wins over the derivation. */
  readonly override?: string;
}

/**
 * The server's own path segment, `<quality>-<commit>`.
 *
 * WebSocket upgrades are matched by **exact pathname**, and the client builds
 * that path with VS Code's own `getServerProductSegment(product)`
 * (`src/vs/base/common/network.ts`):
 *
 * ```ts
 * `${product.quality ?? 'oss'}-${product.commit ?? 'dev'}`
 * ```
 *
 * So this computes the same string rather than guessing it: **quality** and
 * **commit** come from the checkout's `product.json` (falling back to the git
 * HEAD when the file omits the commit), which the built client bundle reads at
 * build time — the two sides then agree by construction.
 *
 * @returns the segment with a leading slash, or `undefined` when it cannot be
 * determined — never a throw, because a caller registers this late and other
 * routes must survive its failure.
 */
export function resolveCodeServerSegment(options: CodeServerSegmentOptions): string | undefined {
  if (options.override) {
    return options.override.startsWith("/") ? options.override : `/${options.override}`;
  }
  // The bundle root is `…/upstream/out-vscode-web`; the checkout root holding
  // product.json and .git is one level up (an override may instead point straight
  // at that root, so both are tried).
  const checkoutRoot = resolve(options.distRoot, "..");
  for (const root of [checkoutRoot, options.distRoot]) {
    try {
      const product = JSON.parse(readFileSync(join(root, "product.json"), "utf8")) as {
        quality?: string;
        commit?: string;
      };
      const commit = product.commit ?? gitHeadCommit(join(root, ".git"));
      if (commit === undefined) continue;
      return `/${product.quality ?? "oss"}-${commit}`;
    } catch {
      // try the next candidate root
    }
  }
  return undefined;
}

/**
 * The commit a git checkout has checked out.
 *
 * Mirrors VS Code's own `build/lib/git.ts`: `.git/HEAD` is either a detached
 * 40-hex commit or `ref: <ref>`, in which case the loose ref file holds it (a
 * `--depth 1` clone keeps that ref present).
 *
 * @param gitDir - the checkout's `.git` directory.
 * @returns the 40-hex commit, or `undefined` when it cannot be read.
 */
function gitHeadCommit(gitDir: string): string | undefined {
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return undefined;
    const value = readFileSync(join(gitDir, ref[1]), "utf8").trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface AssetHandlerOptions {
  /** Directory the bundle is served from. */
  readonly root: string;
  /**
   * Prefix the handler is registered under, stripped from the request path.
   *
   * Route registration normally hands the handler the full pathname
   * (`/prac-vscode/vs/…`), so the mount path has to be removed before it is
   * resolved against {@link AssetHandlerOptions.root}. Absent means the handler
   * owns the whole path.
   */
  readonly mountPath?: string;
}

/** The shape a route registration hands the handler. */
export interface AssetRequest {
  readonly method?: string;
  readonly url?: string;
}

/**
 * Build the handler that serves one bundle file per request.
 *
 * Traversal outside `root` is refused; only `GET`/`HEAD` are answered; a missing
 * file is a 404 (not a throw), so a partially built bundle degrades to missing
 * assets rather than to a dead route.
 */
export function createAssetHandler(
  options: AssetHandlerOptions,
): (req: AssetRequest, res: unknown) => Promise<void> {
  const { root } = options;
  const mountPath = (options.mountPath ?? "").replace(/\/+$/, "");
  return async (req, res) => {
    const response = res as Response;
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const mounted =
      mountPath !== "" && pathname.startsWith(mountPath)
        ? pathname.slice(mountPath.length)
        : pathname;
    const relative = normalize(decodeURIComponent(mounted)).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, relative);
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") {
        response.writeHead(404);
        response.end();
        return;
      }
      throw error;
    }
  };
}

export interface CodeServerProxyOptions {
  /** The code server's host. */
  readonly host: string;
  /** The code server's port. */
  readonly port: number;
}

/** The two channels a code server is reached on. */
export interface CodeServerProxy {
  /** Plain HTTP: forward one request, streaming both ways. */
  handle(req: unknown, res: unknown): void;
  /** WebSocket: tunnel an upgraded socket, replaying the handshake first. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

/**
 * Build the proxy for a code server's HTTP and WebSocket channels.
 *
 * The caller registers {@link CodeServerProxy.handle} on the server's own path
 * segment and {@link CodeServerProxy.upgrade} on the same pathname — the segment
 * is what both sides derive from the build (see {@link resolveCodeServerSegment}).
 */
export function createCodeServerProxy(options: CodeServerProxyOptions): CodeServerProxy {
  const target = { host: options.host, port: options.port };

  const upstreamRequest = (
    req: { method?: string; url?: string; headers?: Record<string, unknown> },
    res: unknown,
  ): void => {
    const response = res as Response;
    const upstream = httpRequest(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `${target.host}:${target.port}` },
      },
      (up) => {
        response.writeHead(up.statusCode ?? 502, up.headers as Record<string, string>);
        up.pipe(res as never);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    (req as unknown as { pipe(target: unknown): void }).pipe(upstream);
  };

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const upstream = netConnect(target.port, target.host, () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        lines.push(
          `${name}: ${name.toLowerCase() === "host" ? `${target.host}:${target.port}` : Array.isArray(value) ? value.join(", ") : value}`,
        );
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  };

  return { handle: upstreamRequest, upgrade };
}
