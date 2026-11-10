/**
 * prac-host-vscode — prac's policy for serving the embedded VS Code build.
 *
 * The mechanism (asset serving on a same-origin route, the code-server HTTP/WS
 * proxy, starting and stopping the server process) lives in `prac-vscode-embed`;
 * what lives here is prac's choices: the route, where the code server's state
 * goes, when one is started at all, and how a dev environment overrides those.
 *
 * **The trunk owns the process.** The code server is a child of this host: it is
 * started when the plugin activates, listens on a port the OS picked, and is
 * stopped when this fiber is disposed. Nothing external has to start it, and no
 * port is hardcoded — the proxy is pointed at whatever the handle reports.
 *
 * The server is started **without** a workspace folder. DSH knows the active
 * workspace on the client side only (`ctx.workspaces` is a client service), and
 * the app already opens the workspace it was booted for through the embed face,
 * so a folder chosen here would be a second, stale answer to a question the
 * client owns. Where the workspace should come from belongs to the transport
 * design, not to this step.
 *
 * Runtime note: the DSH platform package `@deepseek-ai/cordis` is intentionally
 * **not** bundled here. It resolves at runtime from the DSH installation through
 * the profile's module fallback.
 *
 * @module prac-host-vscode
 */

import type { Context } from "@deepseek-ai/cordis";
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAssetHandler,
  createCodeServerProxy,
  freePort,
  resolveBundleRoot,
  resolveCodeServer,
  resolveCodeServerSegment,
  startCodeServer,
  type CodeServerHandle,
} from "prac-vscode-embed";
import { manageLanguageFeatures } from "./language.js";
import { registerTurnDiff, type TurnDiffContext } from "./turn-diff.ts";

/** The `globalThis` property the boot page reads the webview endpoint from. */
export const WEBVIEW_ENDPOINT_GLOBAL = "__pracVscodeWebviewEndpoint";

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-host-vscode";

/** URL prefix the VS Code bundle is served under (same origin as the DSH page). */
export const VSCODE_ROUTE = "/prac-vscode";

/** Overrides where the built bundle is read from (a dev escape hatch). */
const ROOT_ENV = "PRAC_VSCODE_ROOT";

/** Overrides the path of the built code server (a dev escape hatch). */
const SERVER_ENV = "PRAC_CODE_SERVER_ENTRY";

/** Points at a code server someone else manages; no process is started here. */
const URL_ENV = "PRAC_CODE_SERVER_URL";

/** Pins the port a started server listens on (a debugger or a fixed rig wants one). */
const PORT_ENV = "PRAC_CODE_SERVER_PORT";

/** Overrides the server's product segment, for a server that is not this build. */
const SEGMENT_ENV = "PRAC_CODE_SERVER_PATH";

/**
 * The `https://` base webviews are served from, e.g.
 * `https://{{uuid}}.prac.internal/prac-vscode/vs/workbench/contrib/webview/browser/pre/`.
 *
 * Webviews are not our page's origin on purpose: a webview is extension-authored
 * content in a frame sandboxed with `allow-scripts` + `allow-same-origin`, which
 * is only a boundary when the origin differs — and that origin must also be a
 * **secure context** (the webview host registers a service worker) whose
 * hostname is a *subdomain of a name the deployment controls*, because the host
 * page checks that its hostname is the hash of its parent's origin
 * (`pre/index.html`; the renderer substitutes that hash for `{{uuid}}`). Only
 * `https` under a wildcard name satisfies all of it, so prac does not invent an
 * endpoint: the deployment terminates TLS for the wildcard name and forwards
 * here. Unset means the build's own endpoint stands — which is the CDN.
 */
const WEBVIEW_ENDPOINT_ENV = "PRAC_VSCODE_WEBVIEW_ENDPOINT";

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
 * (`<repo>/.build/vscode/out-vscode-web`, the directory holding
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

/** A directory under an XDG base, with the spec's default when the variable is unset. */
function xdg(variable: string, fallback: string): string {
  const value = process.env[variable];
  return value !== undefined && value !== "" ? value : join(homedir(), fallback);
}

/**
 * The code server's state directories, one per XDG category.
 *
 * Extensions are installed files (`data`), logs and workspace/global storage are
 * state that must survive a restart (`state`), and the user data directory is
 * configuration — which is where VS Code itself puts it on Linux. Caches keep
 * their system defaults; no knob is passed for them.
 *
 * @see vendor/vscode/README.md·目录规范 for why these are not in the repository.
 */
function codeServerDirs(): { serverDataDir: string; extensionsDir: string; userDataDir: string } {
  return {
    serverDataDir: join(xdg("XDG_STATE_HOME", ".local/state"), "prac/code-server"),
    extensionsDir: join(xdg("XDG_DATA_HOME", ".local/share"), "prac/code-server/extensions"),
    userDataDir: join(xdg("XDG_CONFIG_HOME", ".config"), "prac/code-server"),
  };
}

/**
 * The product has one agent: Copilot's chat is another agent's UI, and the
 * customer does not want it. The server rejects `--disable-extension` ("not
 * supported for server"), so move the extension out of the profile's extensions
 * directory before the server scans it. The move is reversible: the directory
 * stays under `extensions-disabled/`, and Copilot completions are untouched.
 *
 * @param extensionsDir - the profile's `--extensions-dir`.
 */
async function quarantineCopilotChat(extensionsDir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true });
  } catch {
    return;
  }
  const disabled = join(dirname(extensionsDir), "extensions-disabled");
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^github\.copilot-chat-/i.test(entry.name)) continue;
    const from = join(extensionsDir, entry.name);
    const to = join(disabled, entry.name);
    try {
      await mkdir(disabled, { recursive: true });
      await rename(from, to);
      console.log(`${name}: quarantined ${entry.name} (Copilot chat is not part of prac)`);
    } catch (error: unknown) {
      console.warn(`${name}: could not quarantine ${entry.name}: ${String(error)}`);
    }
  }
}

/** Where the proxy should forward: an outside server, or one we started. */
interface CodeServerTarget {
  readonly host: string;
  readonly port: number;
  /** Present only when this plugin started it — then it also stops it. */
  readonly handle?: CodeServerHandle;
}

/**
 * The code server an escape hatch points at, if one does.
 *
 * A dev environment may keep its own server (a debugger attached to it, a build
 * being compared): `PRAC_CODE_SERVER_URL=http://127.0.0.1:3091` then takes over
 * completely — nothing is spawned, and nothing is stopped on dispose.
 */
function externalTarget(): CodeServerTarget | undefined {
  const raw = process.env[URL_ENV];
  if (raw === undefined || raw === "") return undefined;
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: Number(url.port === "" ? (url.protocol === "https:" ? 443 : 80) : url.port),
    };
  } catch {
    console.warn(`${name}: ${URL_ENV} is not a URL: ${raw} — ignoring it`);
    return undefined;
  }
}

/**
 * Start the code server this checkout built, unless something else already is.
 *
 * @returns the proxy target, or `undefined` when no server is available — the
 * page then works without a remote session, which is the same degradation the
 * proxy's absence has always produced.
 */
async function launchCodeServer(): Promise<CodeServerTarget | undefined> {
  const external = externalTarget();
  if (external) {
    console.log(`${name}: using the code server at ${external.host}:${external.port} (${URL_ENV})`);
    return external;
  }

  const { entry, cwd } = resolveCodeServer({
    from: moduleDir,
    override: process.env[SERVER_ENV],
  });
  if (!existsSync(entry)) {
    console.warn(
      `${name}: no built code server at ${entry}; run vscode:build (or set ${SERVER_ENV})`,
    );
    return undefined;
  }

  const dirs = codeServerDirs();
  await quarantineCopilotChat(dirs.extensionsDir);
  const handle = await startCodeServer({
    entry,
    cwd,
    port: Number(process.env[PORT_ENV] ?? "") || (await freePort()),
    ...dirs,
    // The prac dev rig is local and single-user; a token would have to travel to
    // the page, which is the transport design's business, not this step's.
    extraArgs: ["--without-connection-token"],
    onOutput: (line, stream) => {
      const write = stream === "stderr" ? console.warn : console.log;
      write(`${name}: code-server | ${line}`);
    },
    onExit: (code, signal) => {
      console.warn(
        `${name}: the code server exited (code=${code ?? "none"}, signal=${signal ?? "none"})`,
      );
    },
  });
  console.log(`${name}: code server started on ${handle.host}:${handle.port} (pid ${handle.pid})`);
  return { host: handle.host, port: handle.port, handle };
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
function attachCodeServerProxy(webCtx: Context, target: CodeServerTarget): void {
  const server: WebServer = webCtx.webServer;
  try {
    const segment = codeServerPath();
    if (segment === undefined) return; // already logged by codeServerPath()

    const proxy = createCodeServerProxy(target);
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
      `${name}: proxy ${segment}/* → ${target.host}:${target.port}`,
    );

    // The channel that actually carries the session: management and extension
    // host connections upgrade on the same segment, and upgrades match by exact
    // pathname.
    webCtx.effect(
      () => server.registerUpgrade({ path: segment, handler: proxy.upgrade.bind(proxy) }),
      `${name}: upgrade ${segment} → ${target.host}:${target.port}`,
    );
  } catch (error) {
    console.warn(
      `${name}: the code-server proxy could not be attached; the VS Code route stays served ` +
        `without a remote session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Own the code server's lifetime: start it once the host server exists, and stop
 * it when this fiber goes away.
 *
 * A second `attachCodeServerProxy` on the same context would register the routes
 * twice, so the proxy is attached from the same effect that started the process —
 * one owner, one registration.
 */
function manageCodeServer(webCtx: Context): void {
  webCtx.effect(() => {
    let cancelled = false;
    let handle: CodeServerHandle | undefined;
    void launchCodeServer()
      .then((target) => {
        if (target === undefined) return;
        if (cancelled) {
          void target.handle?.stop();
          return;
        }
        handle = target.handle;
        attachCodeServerProxy(webCtx, target);
      })
      .catch((error: unknown) => {
        console.warn(
          `${name}: the code server could not be started; the VS Code route stays served ` +
            `without a remote session: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return () => {
      cancelled = true;
      void handle?.stop();
    };
  }, `${name}: code server`);
}

/** Serve the VS Code bundle on a same-origin route, and reach a code server. */
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
    // The PDF window reads its bytes through this route: the document-preview
    // app is client-side, and has no other workspace file source.
    webCtx.effect(
      () =>
        server.register({
          kind: "prefix",
          path: "/api/prac-file",
          handler: async (rawReq: { url?: string } | undefined, res: unknown) => {
            const response = res as {
              statusCode: number;
              setHeader(name: string, value: string): void;
              end(body?: Uint8Array | string): void;
            };
            const requestUrl = rawReq?.url ?? "";
            const path = new URL(requestUrl, "http://localhost").searchParams.get("path");
            if (path === null || path === "") {
              response.statusCode = 400;
              response.end("missing path");
              return;
            }
            try {
              const bytes = await readFile(path);
              response.statusCode = 200;
              response.setHeader("content-type", "application/octet-stream");
              response.end(bytes);
            } catch {
              response.statusCode = 404;
              response.end("not found");
            }
          },
        }),
      `${name}: GET /api/prac-file`,
    );

    // Hand the page the webview endpoint, when the deployment configured one.
    // An index injection is the existing channel for a server-side value the
    // page needs at boot — no new mechanism, and no assumption about which
    // address the client used (the template carries the deployment's name).
    const webviewEndpoint = process.env[WEBVIEW_ENDPOINT_ENV];
    if (webviewEndpoint !== undefined && webviewEndpoint !== "") {
      webCtx.effect(
        () =>
          webCtx.on("webserver/index-inject", (table: unknown[]) => {
            table.push({
              kind: "global",
              name: WEBVIEW_ENDPOINT_GLOBAL,
              value: webviewEndpoint,
            });
          }),
        `${name}: inject the webview endpoint`,
      );
      console.log(`${name}: webviews are served from ${webviewEndpoint} (${WEBVIEW_ENDPOINT_ENV})`);
    }

    manageCodeServer(webCtx);
  });

  // The changed-files card's turn-scoped diff text. This is a Host capability,
  // not a VS Code one, but it lives here because this is the bundle's only host
  // row today; splitting it into `prac-host-turn-diff` is a package move, not a
  // behavior change. It reads the snapshots DSH already records; it does not
  // record a second copy.
  ctx.inject(["workspaceChanges", "connection", "subprocess"], (turnCtx) => {
    registerTurnDiff(turnCtx as unknown as TurnDiffContext);
  });

  // The other half of the VS Code side: the extensions themselves. Injected on
  // `lsp` rather than declared, so a profile without the seam composes exactly
  // as before — and nothing is forked until a language question is asked.
  const codeServer = codeServerDirs();
  manageLanguageFeatures(ctx, {
    checkoutRoot: dirname(bundleRoot()),
    userExtensionsDir: codeServer.extensionsDir,
    // The code server's own storage, which is what an extension host is given:
    // it sits under `--server-data-dir` (therefore under XDG's *state*, which is
    // where VS Code keeps this kind of data) — not a second root of ours, which
    // would be inventing a store for the same thing.
    globalStorageHome: join(codeServer.serverDataDir, "data/User/globalStorage"),
    workspaceStorageHome: join(codeServer.serverDataDir, "data/User/workspaceStorage"),
    // The global layer of the agent side's enablement policy: **configuration**,
    // under XDG's config next to prac's other settings, named and shaped like a
    // VS Code settings file. The workspace layer is
    // `<workspace>/.agent/prac/settings.json`.
    extensionsSettingsPath: join(xdg("XDG_CONFIG_HOME", ".config"), "prac/settings.json"),
  });
}
