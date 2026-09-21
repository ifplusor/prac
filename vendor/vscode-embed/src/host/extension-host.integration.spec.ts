/**
 * The extension-host mechanism, against the **real build**.
 *
 * There is no stand-in for this: the point is that our carrier, our handshake
 * and upstream's bundled host agree byte for byte. The suite skips itself when
 * the checkout has not been built, so a machine without `.build/vscode` still
 * runs the rest of the package's tests.
 *
 * What is asserted: the handshake completes, the protocol tables come from the
 * build we are connected to, and RPC actually flows — the host's start-up
 * bookkeeping calls reach implementations we registered.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveExtensionHost, startExtensionHost } from "./extension-host.js";

const location = resolveExtensionHost({ from: fileURLToPath(new URL(".", import.meta.url)) });
const built =
  existsSync(location.bootstrap) &&
  existsSync(join(location.outBuild, "vs/workbench/api/common/extHost.protocol.js"));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Init data with no parent watchdog and no storage expectations of its own. */
function probeInitData(home: string) {
  const uri = (name: string) => ({ scheme: "file", path: join(home, name) });
  return {
    environment: {
      appName: "prac",
      appHost: "node",
      appLanguage: "en",
      appUriScheme: "prac",
      globalStorageHome: uri("globalStorage"),
      workspaceStorageHome: uri("workspaceStorage"),
    },
    extensions: { versionId: 1, allExtensions: [], activationEvents: {}, myExtensions: [] },
    telemetryInfo: {
      sessionId: "test-session",
      machineId: "test-machine",
      sqmId: "test-sqm",
      devDeviceId: "test-device",
      firstSessionDate: new Date().toISOString(),
    },
    parentPid: 0,
  };
}

/** Wait for `check` to hold, or fail with the last thing seen. */
async function until(
  check: () => boolean,
  describeWait: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describeWait}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

describe.skipIf(!built)("extension host: the real build", () => {
  it("completes the handshake and dispatches RPC into actors we registered", async () => {
    const home = mkdtempSync(join(tmpdir(), "prac-exthost-test-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));

    const commands: string[] = [];
    const loggers: unknown[] = [];
    const host = await startExtensionHost({
      location,
      initData: probeInitData(home),
      onOutput: () => undefined,
      // Registering through `configure` is the contract: the host's start-up
      // calls arrive before `startExtensionHost` returns.
      configure: ({ rpc, protocol }) => {
        rpc.set(protocol.MainContext.MainThreadCommands!, {
          $registerCommand: (id: string) => void commands.push(id),
          $unregisterCommand: () => undefined,
          $fireCommandActivationEvent: () => undefined,
          $executeCommand: () => Promise.resolve(undefined),
          $getCommands: () => Promise.resolve([]),
        });
        rpc.set(protocol.MainContext.MainThreadLogger!, {
          $registerLogger: (logger: unknown) => {
            loggers.push(logger);
            return Promise.resolve();
          },
          $log: () => undefined,
          $flush: () => undefined,
          $createLogger: () => Promise.resolve(),
          $deregisterLogger: () => Promise.resolve(),
          $setVisibility: () => Promise.resolve(),
        });
      },
    });
    cleanups.push(() => void host.dispose());

    // The tables are the ones the connected build ships: 87 + 81 identifiers.
    expect(Object.keys(host.protocol.MainContext).length).toBe(87);
    expect(Object.keys(host.protocol.ExtHostContext).length).toBe(81);

    await until(() => commands.length > 0 && loggers.length > 0, "the host's start-up RPC calls");
    expect(commands.length).toBeGreaterThan(0);
    expect(host.initData.commit).toBe(location.product.commit);
    expect(host.child.exitCode).toBeNull();

    await host.dispose();
    await until(
      () => host.child.exitCode !== null || host.child.signalCode !== null,
      "the host to stop",
    );
  }, 90_000);
});
