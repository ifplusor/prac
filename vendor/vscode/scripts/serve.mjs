/**
 * Static server for the independent viewing page.
 *
 * Two routes, no staging on disk: `/` is our own shell
 * (`overlay/page.html`) and `/out/*` is the built web bundle inside the
 * checkout. The shell refers to its assets relatively (`./out/…`), so those
 * two mappings are all it needs — nothing has to be copied or symlinked, which
 * is why the old `stage/` directory is gone.
 *
 * This page boots the workbench **without** the embed bridge, so it exercises
 * VS Code's default path; `vscode:smoke` runs against it as the canary for
 * "our patch did not break the normal web app".
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const PAGE = join(packageDir, "overlay/page.html");
const BUNDLE = join(workDir, "out-vscode-web");
const PORT = Number(process.env.PORT ?? 5199);

const TYPES = {
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

/** Map a request path to a file: the shell itself, or anything under the bundle. */
function fileFor(path) {
  if (path === "/" || path === "/index.html") return PAGE;
  if (path.startsWith("/out/")) {
    const relative = normalize(path.slice("/out/".length)).replace(/^(\.\.[/\\])+/, "");
    return join(BUNDLE, relative);
  }
  return undefined;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    const filePath = fileFor(path);
    if (filePath === undefined) throw new Error(`no route for ${path}`);
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { location: `${path}/` });
      res.end();
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`not found: ${error instanceof Error ? error.message : String(error)}`);
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[prac-vscode] serving ${PAGE} + ${BUNDLE} at http://127.0.0.1:${PORT}/`);
});
