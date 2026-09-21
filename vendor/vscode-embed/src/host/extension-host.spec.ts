/**
 * Tests for the extension-host mechanism.
 *
 * Only the parts that do not need a VS Code build are asserted here: where the
 * pieces are found, what the child's environment has to contain, and what the
 * init-data frame is stamped with. The carrier + handshake are exercised against
 * the real build by the harness script that exercises this module end to end —
 * there is nothing in a stand-in that could stand in for the protocol.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  EXTENSION_HOST_ENTRYPOINT,
  extensionHostEnv,
  extensionHostInitData,
  resolveExtensionHost,
} from "./extension-host.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A fake checkout: `…/repo/.build/vscode/{out-vscode-reh,out-build,product.json}`. */
function fakeCheckout(product: Record<string, unknown> = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "prac-embed-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  const checkout = join(repo, ".build", "vscode");
  mkdirSync(join(checkout, "out-vscode-reh"), { recursive: true });
  mkdirSync(join(checkout, "out-build"), { recursive: true });
  writeFileSync(
    join(checkout, "out-vscode-reh", "bootstrap-fork.js"),
    "// stand-in for the fork entry\n",
  );
  writeFileSync(join(checkout, "out-vscode-reh", "nls.messages.json"), JSON.stringify(["(empty)"]));
  writeFileSync(join(checkout, "product.json"), JSON.stringify(product));
  return repo;
}

const ENVIRONMENT = {
  appName: "prac",
  appHost: "node",
  appLanguage: "en",
  appUriScheme: "prac",
  globalStorageHome: { scheme: "file", path: "/state/globalStorage" },
  workspaceStorageHome: { scheme: "file", path: "/state/workspaceStorage" },
};

const INIT_DATA = {
  environment: ENVIRONMENT,
  extensions: { versionId: 1, allExtensions: [], activationEvents: {}, myExtensions: [] },
  telemetryInfo: {
    sessionId: "s",
    machineId: "m",
    sqmId: "q",
    devDeviceId: "d",
    firstSessionDate: "2026-09-21T00:00:00.000Z",
  },
};

describe("resolveExtensionHost", () => {
  it("walks up from a consumer directory to the build", () => {
    const repo = fakeCheckout({ version: "1.137.0", commit: "abc" });
    const location = resolveExtensionHost({ from: join(repo, "packages", "host", "vscode") });
    const checkout = join(repo, ".build", "vscode");
    expect(location.bootstrap).toBe(join(checkout, "out-vscode-reh", "bootstrap-fork.js"));
    expect(location.checkoutRoot).toBe(checkout);
    expect(location.rehRoot).toBe(join(checkout, "out-vscode-reh"));
    expect(location.outBuild).toBe(join(checkout, "out-build"));
    expect(location.product).toEqual({ version: "1.137.0", quality: undefined, commit: "abc" });
  });

  it("honours an explicit entry over the search", () => {
    const repo = fakeCheckout();
    const entry = join(repo, ".build", "vscode", "out-vscode-reh", "bootstrap-fork.js");
    expect(resolveExtensionHost({ from: tmpdir(), override: entry }).bootstrap).toBe(entry);
  });

  it("reads a checkout without a product.json as unknown rather than failing", () => {
    const repo = fakeCheckout();
    rmSync(join(repo, ".build", "vscode", "product.json"));
    expect(resolveExtensionHost({ from: repo }).product).toEqual({
      version: undefined,
      quality: undefined,
      commit: undefined,
    });
  });
});

describe("extensionHostEnv", () => {
  it("carries the entry point, the pipe, and the message table", () => {
    const repo = fakeCheckout();
    const location = resolveExtensionHost({ from: repo });
    const env = extensionHostEnv(location, "/tmp/exthost.sock", { PATH: "/usr/bin" });
    expect(env.VSCODE_ESM_ENTRYPOINT).toBe(EXTENSION_HOST_ENTRYPOINT);
    expect(env.VSCODE_EXTHOST_IPC_HOOK).toBe("/tmp/exthost.sock");
    expect(env.VSCODE_HANDLES_UNCAUGHT_ERRORS).toBe("true");
    expect(JSON.parse(env.VSCODE_NLS_CONFIG ?? "{}")).toEqual({
      resolvedLanguage: "en",
      defaultMessagesFile: join(location.rehRoot, "nls.messages.json"),
    });
    expect(env.PATH).toBe("/usr/bin");
  });
});

describe("extensionHostInitData", () => {
  it("stamps the build's identity and the mechanism's defaults", () => {
    const repo = fakeCheckout({ version: "1.137.0", quality: "oss", commit: "abc" });
    const location = resolveExtensionHost({ from: repo });
    const data = extensionHostInitData(location, { ...INIT_DATA, parentPid: 0 });
    expect(data.version).toBe("1.137.0");
    expect(data.quality).toBe("oss");
    expect(data.commit).toBe("abc");
    expect(data.parentPid).toBe(0);
    expect(data.autoStart).toBe(true);
    expect(data.remote).toEqual({ isRemote: false, authority: undefined, connectionData: null });
    expect(data.uiKind).toBe(1);
    expect(data.logsLocation).toBe(ENVIRONMENT.globalStorageHome);
    expect(typeof data.date).toBe("string");
  });

  it("watches the parent by default and lets the caller turn it off", () => {
    const repo = fakeCheckout();
    const location = resolveExtensionHost({ from: repo });
    expect(extensionHostInitData(location, INIT_DATA).parentPid).toBe(process.pid);
    expect(extensionHostInitData(location, { ...INIT_DATA, parentPid: 0 }).parentPid).toBe(0);
  });

  it("keeps the caller's workspace and autoStart", () => {
    const repo = fakeCheckout();
    const location = resolveExtensionHost({ from: repo });
    const data = extensionHostInitData(location, {
      ...INIT_DATA,
      workspace: { id: "w", name: "workspace" },
      autoStart: false,
      logLevel: 2,
    });
    expect(data.workspace).toEqual({ id: "w", name: "workspace" });
    expect(data.autoStart).toBe(false);
    expect(data.logLevel).toBe(2);
  });

  it("defaults a workspace-less host to null rather than undefined", () => {
    const repo = fakeCheckout();
    const location = resolveExtensionHost({ from: repo });
    expect(extensionHostInitData(location, INIT_DATA).workspace).toBeNull();
  });
});
