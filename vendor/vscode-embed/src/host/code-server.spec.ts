/**
 * Tests for the code-server mechanism.
 *
 * The pure parts (argv, port picking, readiness) are asserted directly; the
 * start/ready/stop cycle is exercised against a **stand-in** server script, so
 * the mechanism is proven without a VS Code build or a checkout on disk.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  codeServerArgv,
  freePort,
  isReady,
  resolveCodeServer,
  startCodeServer,
  waitForReady,
} from "./code-server.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A thrown promise's message, for asserting on failure text. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

describe("codeServerArgv", () => {
  it("carries port, host and the directories it is given", () => {
    expect(
      codeServerArgv({
        port: 4321,
        serverDataDir: "/state",
        extensionsDir: "/data/extensions",
        userDataDir: "/config",
      }),
    ).toEqual([
      "--port",
      "4321",
      "--host",
      "127.0.0.1",
      "--server-data-dir",
      "/state",
      "--extensions-dir",
      "/data/extensions",
      "--user-data-dir",
      "/config",
    ]);
  });

  it("omits what it is not given, and puts the folder last", () => {
    expect(
      codeServerArgv({ port: 1, folder: "/work", extraArgs: ["--without-connection-token"] }),
    ).toEqual(["--port", "1", "--host", "127.0.0.1", "--without-connection-token", "/work"]);
  });

  it("lets the consumer choose the host", () => {
    expect(codeServerArgv({ port: 1, host: "0.0.0.0" })).toEqual([
      "--port",
      "1",
      "--host",
      "0.0.0.0",
    ]);
  });
});

describe("resolveCodeServer", () => {
  it("walks up to the repository root that holds the conventional build", () => {
    const root = mkdtempSync(join(tmpdir(), "prac-embed-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const entry = join(root, ".build", "vscode", "out-vscode-reh", "server-main.js");
    const nested = join(root, "packages", "host", "vscode", "dist");
    writeFileSync(join(root, "package.json"), "{}");
    mkdirSync(join(root, ".build", "vscode", "out-vscode-reh"), { recursive: true });
    writeFileSync(entry, "");
    mkdirSync(nested, { recursive: true });

    expect(resolveCodeServer({ from: nested })).toEqual({ entry, cwd: root });
  });

  it("returns the conventional path (not a crash) when nothing was built", () => {
    const root = mkdtempSync(join(tmpdir(), "prac-embed-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const found = resolveCodeServer({ from: join(root, "a", "b") });
    expect(found.entry.endsWith(join("out-vscode-reh", "server-main.js"))).toBe(true);
  });

  it("takes an explicit entry and derives its checkout root", () => {
    expect(
      resolveCodeServer({ from: "/nowhere", override: "/opt/x/out-vscode-reh/server-main.js" }),
    ).toEqual({
      entry: "/opt/x/out-vscode-reh/server-main.js",
      cwd: "/opt/x",
    });
  });
});

describe("freePort", () => {
  it("returns a port that can then be bound", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const server = createServer();
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
    cleanups.push(() => server.close());
    expect(server.address()).toMatchObject({ port });
  });
});

describe("readiness", () => {
  it("reports not-ready for a port nothing listens on", async () => {
    const port = await freePort();
    expect(await isReady(`http://127.0.0.1:${port}`, 200)).toBe(false);
  });

  it("resolves once /version answers 200", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("commit");
    });
    const port = await freePort();
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
    cleanups.push(() => server.close());
    await expect(
      waitForReady(`http://127.0.0.1:${port}`, { timeoutMs: 2000 }),
    ).resolves.toBeUndefined();
  });

  it("gives up at the deadline", async () => {
    const port = await freePort();
    const message = await rejection(
      waitForReady(`http://127.0.0.1:${port}`, { timeoutMs: 300, intervalMs: 50 }),
    );
    expect(message).toContain("did not answer within 300ms");
  });
});

describe("startCodeServer", () => {
  /** A stand-in server: answers /version, prints a line, exits on SIGTERM. */
  const standIn = `
    const { createServer } = require("node:http");
    const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
    console.log("stand-in listening on " + port);
    createServer((_req, res) => { res.writeHead(200); res.end("ok"); })
      .listen(port, "127.0.0.1");
  `;

  it("starts, reports ready, and stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prac-embed-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const entry = join(dir, "server-main.js");
    writeFileSync(entry, standIn);
    const output: string[] = [];

    const handle = await startCodeServer({
      entry,
      cwd: dir,
      port: await freePort(),
      onOutput: (line) => output.push(line),
      readyTimeoutMs: 5000,
    });
    expect(handle.exited).toBe(false);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
    expect(output.join("\n")).toContain("stand-in listening");

    await handle.stop();
    expect(handle.exited).toBe(true);
    // The port is free again once the process is gone.
    const server = createServer();
    await new Promise<void>((done) => server.listen(handle.port, "127.0.0.1", done));
    cleanups.push(() => server.close());
  });

  it("rejects with the child's output when it never becomes reachable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prac-embed-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const entry = join(dir, "server-main.js");
    writeFileSync(entry, `console.error("boom: refusing to start");`);

    const message = await rejection(
      startCodeServer({ entry, cwd: dir, port: await freePort(), readyTimeoutMs: 500 }),
    );
    expect(message).toContain("never became reachable");
    expect(message).toContain("boom: refusing to start");
  });
});
