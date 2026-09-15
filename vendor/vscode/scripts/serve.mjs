/** Static file server for the staged prac workbench surface. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"));
const ROOT = join(workDir, "web");
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

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const filePath = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
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
  console.log(`[prac-vscode] serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
