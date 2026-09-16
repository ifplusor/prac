/**
 * prac-host-vscode — prac's policy for serving the embedded VS Code build.
 *
 * The mechanism (asset serving on a same-origin route, code-server HTTP/WS proxy)
 * lives in `prac-vscode-embed`; what lives here is prac's choices: the route, the
 * code server's port, where this repository keeps its build, and how a dev
 * environment overrides those.
 *
 * Runtime note: the DSH platform package `@deepseek-ai/cordis` is intentionally
 * **not** bundled here. It resolves at runtime from the DSH installation through
 * the profile's module fallback.
 *
 * @module prac-host-vscode
 */

import type { Context } from "@deepseek-ai/cordis";
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { fileURLToPath } from "node:url";
import {
  createAssetHandler,
  createCodeServerProxy,
  resolveBundleRoot,
  resolveCodeServerSegment,
} from "prac-vscode-embed";

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-host-vscode";

/** URL prefix the VS Code bundle is served under (same origin as the DSH page). */
export const VSCODE_ROUTE = "/prac-vscode";

/** Overrides where the built bundle is read from (a dev escape hatch). */
const ROOT_ENV = "PRAC_VSCODE_ROOT";

/** Overrides the server's product segment, for a server that is not this build. */
const SEGMENT_ENV = "PRAC_CODE_SERVER_PATH";

/** The self-built VS Code server this host proxies for the browser. */
const CODE_SERVER = { host: "127.0.0.1", port: 3091 };

/**
 * Where this module sits — the starting point of the upward search for the build.
 *
 * The search walks up rather than counting `../` segments: the served root moved
 * between packages once already, and a miscounted segment fails as a silent 404
 * on every asset instead of as an error.
 */
const moduleDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * The bundle `prac-vscode`'s `vscode:build` produced
 * (`<repo>/.build/vscode/upstream/out-vscode-web`, the directory holding
 * `vs/…` and `nls.messages.js` — *not* the `web/` staging page, which is for the
 * standalone smoke server).
 */
export function bundleRoot(): string {
  return resolveBundleRoot({ from: moduleDir, override: process.env[ROOT_ENV] });
}

/**
 * The server's own path segment (`<quality>-<commit>`), derived from the
 * checkout the bundle came from so the client and the server agree by
 * construction. An explicit `PRAC_CODE_SERVER_PATH` still wins.
 *
 * @returns the segment with a leading slash, or `undefined` when it cannot be
 * determined — never a throw, because the caller registers this after routes
 * that must survive its failure.
 */
export function codeServerPath(): string | undefined {
  const segment = resolveCodeServerSegment({
    distRoot: bundleRoot(),
    override: process.env[SEGMENT_ENV],
  });
  if (segment === undefined) {
    console.warn(
      `${name}: cannot resolve the code server path (no readable product.json with a commit); ` +
        `WebSocket upgrades stay unproxied — set ${SEGMENT_ENV} if the server is not this checkout`,
    );
  }
  return segment;
}

/**
 * Attach the code-server proxy to the host server.
 *
 * Wrapped so that it cannot cancel the registration that *must* survive: an
 * exception thrown inside the parent `ctx.inject` callback once tore down this
 * whole fiber's registrations, which presented as the VS Code route 404-ing — a
 * static-file symptom for a proxy bug. Isolating and catching here keeps the
 * blast radius at "the proxy is absent", which is a working page without a
 * remote session.
 *
 * @param webCtx - the context resolved once `webServer` exists.
 */
function attachCodeServerProxy(webCtx: Context): void {
  const server: WebServer = webCtx.webServer;
  try {
    const segment = codeServerPath();
    if (segment === undefined) return; // already logged by codeServerPath()

    const proxy = createCodeServerProxy(CODE_SERVER);
    // The HTTP channel: CORS applies to it, so a page on DSH's origin cannot
    // fetch the server's port directly. Same-origin proxying removes the
    // boundary — the browser only ever talks to DSH.
    webCtx.effect(
      () =>
        server.register({
          kind: "prefix",
          path: segment,
          handler: async (rawReq: unknown, res: unknown) => proxy.handle(rawReq, res),
        }),
      `${name}: proxy ${segment}/* → ${CODE_SERVER.host}:${CODE_SERVER.port}`,
    );

    // The channel that actually carries the session: management and extension
    // host connections upgrade on the same segment, and upgrades match by exact
    // pathname.
    webCtx.effect(
      () => server.registerUpgrade({ path: segment, handler: proxy.upgrade }),
      `${name}: upgrade ${segment} → ${CODE_SERVER.host}:${CODE_SERVER.port}`,
    );
  } catch (error) {
    console.warn(
      `${name}: the code-server proxy could not be attached; the VS Code route stays served ` +
        `without a remote session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Serve the VS Code bundle on a same-origin route. */
export function apply(ctx: Context): void {
  // Optional: only web profiles carry `webServer`, so inject it lazily rather
  // than declaring it required (which would keep the plugin from activating on a
  // headless profile).
  ctx.inject(["webServer"], (webCtx) => {
    const server: WebServer = webCtx.webServer;
    const serveAsset = createAssetHandler({ root: bundleRoot(), mountPath: VSCODE_ROUTE });
    webCtx.effect(
      () =>
        server.register({
          kind: "prefix",
          path: VSCODE_ROUTE,
          handler: async (rawReq: unknown, res: unknown) =>
            serveAsset(rawReq as { method?: string; url?: string }, res),
        }),
      `${name}: GET ${VSCODE_ROUTE}`,
    );
    attachCodeServerProxy(webCtx);
  });
}
