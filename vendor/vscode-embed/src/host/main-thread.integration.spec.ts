/**
 * The minimum main thread, against the **real** built-in css extension.
 *
 * This is the milestone the whole module exists for: a genuine extension — the
 * one VS Code ships, with its own language client — activates inside a host we
 * started, and registers the providers it is written to register. Nothing is
 * stubbed on the extension side; what it needs from us, we answer.
 *
 * Skips itself when the checkout or the extension has not been built, so the
 * package's tests stay runnable without one.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveExtensionHost } from "./extension-host.js";
import { scanExtensions } from "./extensions.js";
import { startMainThread, type LanguageFeatureRegistration } from "./main-thread.js";

const location = resolveExtensionHost({ from: fileURLToPath(new URL(".", import.meta.url)) });
const extensionRoot = join(location.checkoutRoot, "extensions", "css-language-features");
const built =
  existsSync(location.bootstrap) &&
  existsSync(join(extensionRoot, "client", "out", "node", "cssClientMain.js")) &&
  existsSync(join(extensionRoot, "server", "out", "node", "cssServerMain.js"));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Wait for a condition, or fail with what we saw instead. */
async function until(
  check: () => boolean,
  describeWait: string,
  detail: () => string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${describeWait}\n${detail()}`);
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe.skipIf(!built)("main thread: the built-in css extension", () => {
  it("activates the extension and collects the providers it registers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "prac-css-"));
    cleanups.push(() => rmSync(workspaceRoot, { recursive: true, force: true }));
    const file = join(workspaceRoot, "style.css");
    writeFileSync(file, "body {\n  colour: red;\n}\n");

    const extensions = scanExtensions({ builtinDir: join(location.checkoutRoot, "extensions") });
    const css = extensions.find(
      (extension) => extension.identifier.value === "vscode.css-language-features",
    );
    expect(css, "the checkout should have the css extension").toBeDefined();

    const log: string[] = [];
    const host = await startMainThread({
      location,
      policy: {
        environment: {
          appName: "prac",
          appHost: "node",
          appUriScheme: "prac",
          globalStorageHome: { scheme: "file", path: join(workspaceRoot, "globalStorage") },
          workspaceStorageHome: { scheme: "file", path: join(workspaceRoot, "workspaceStorage") },
          telemetry: {
            sessionId: "test-session",
            machineId: "test-machine",
            sqmId: "test-sqm",
            devDeviceId: "test-device",
            firstSessionDate: new Date().toISOString(),
          },
        },
        extensions,
        myExtensions: ["vscode.css-language-features"],
        workspace: {
          id: "prac-css-test",
          name: "css-test",
          folders: [{ uri: { scheme: "file", path: workspaceRoot }, name: "css-test", index: 0 }],
        },
        documents: [
          {
            uri: { scheme: "file", path: file },
            languageId: "css",
            text: "body {\n  colour: red;\n}\n",
          },
        ],
        onLog: (message) => log.push(message),
        onUnhandledCall: ({ actor, method }) => log.push(`unhandled ${actor}.${method}`),
      },
      onOutput: (stream, chunk) => log.push(`${stream}: ${chunk.trim()}`),
    });
    cleanups.push(() => void host.dispose());

    await host.activateByEvent("onLanguage:css");

    const hover = (): LanguageFeatureRegistration | undefined =>
      host.registrations.find((registration) => registration.kind === "hover");
    await until(
      () => hover() !== undefined,
      "the css extension to register a hover provider",
      () =>
        `registrations: ${host.registrations.map((r) => r.kind).join(", ") || "(none)"}\nlog:\n${log.join("\n")}`,
    );

    expect(hover()?.selector).toBeDefined();
    // The language client registers a whole family, not just hover.
    expect(host.registrations.length).toBeGreaterThan(1);

    await host.dispose();
  }, 120_000);

  it("answers a hover from the language server the extension started", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "prac-css-hover-"));
    cleanups.push(() => rmSync(workspaceRoot, { recursive: true, force: true }));
    const file = join(workspaceRoot, "hover.css");
    const text = "body {\n  color: red;\n}\n";
    writeFileSync(file, text);
    const uri = { scheme: "file", path: file };

    const extensions = scanExtensions({ builtinDir: join(location.checkoutRoot, "extensions") });
    const log: string[] = [];
    const host = await startMainThread({
      location,
      policy: {
        environment: {
          appName: "prac",
          appHost: "node",
          appUriScheme: "prac",
          globalStorageHome: { scheme: "file", path: join(workspaceRoot, "globalStorage") },
          workspaceStorageHome: { scheme: "file", path: join(workspaceRoot, "workspaceStorage") },
          telemetry: {
            sessionId: "test-session",
            machineId: "test-machine",
            sqmId: "test-sqm",
            devDeviceId: "test-device",
            firstSessionDate: new Date().toISOString(),
          },
        },
        extensions,
        myExtensions: ["vscode.css-language-features"],
        workspace: {
          id: "prac-css-hover",
          name: "css-hover",
          folders: [{ uri: { scheme: "file", path: workspaceRoot }, name: "css-hover", index: 0 }],
        },
        documents: [{ uri, languageId: "css", text }],
        onLog: (message) => log.push(message),
        onUnhandledCall: ({ actor, method }) => log.push(`unhandled ${actor}.${method}`),
      },
      onOutput: (stream, chunk) => log.push(`${stream}: ${chunk.trim()}`),
    });
    cleanups.push(() => void host.dispose());

    await host.activateByEvent("onLanguage:css");
    const hover = (): LanguageFeatureRegistration | undefined =>
      host.registrations.find((registration) => registration.kind === "hover");
    await until(
      () => hover() !== undefined,
      "the css extension to register a hover provider",
      () =>
        `registrations: ${host.registrations.map((r) => r.kind).join(", ") || "(none)"}\nlog:\n${log.join("\n")}`,
    );

    // The provider is called the way the protocol calls it: an opaque handle, a
    // URI and a zero-based position; the one-based conversion and the
    // cancellation token stay inside the module.
    const hoverResult = await host.provideHover(hover()!.handle, uri, { line: 1, character: 3 });
    const contents = hoverResult?.contents ?? "";
    // A real answer from the css language service: the hover for a property
    // documents the property, and nothing we wrote ourselves could know that.
    expect(contents.toLowerCase()).toContain("color");

    await host.dispose();
  }, 120_000);
});
