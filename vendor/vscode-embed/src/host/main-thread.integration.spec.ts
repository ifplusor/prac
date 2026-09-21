/**
 * The minimum main thread, against the **real** built-in css extension.
 *
 * This is the milestone the whole module exists for: a genuine extension — the
 * one VS Code ships, with its own language client — activates inside a host we
 * started, registers the providers it is written to register, and answers
 * questions through the providers it started.
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
import { startMainThread, type LanguageFeatureKind, type MainThreadHandle } from "./main-thread.js";

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

interface CssHost {
  readonly host: MainThreadHandle;
  readonly workspaceRoot: string;
  readonly log: string[];
  /** Absolute path of a file written into the workspace. */
  path(name: string): string;
  /** Wait until a provider of this kind registered and hand it back. */
  registration(kind: LanguageFeatureKind): Promise<number>;
}

/** Start a host over a scratch workspace holding `files`, documents included. */
async function startCssHost(files: Record<string, string>): Promise<CssHost> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "prac-css-"));
  cleanups.push(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const documents = Object.entries(files).map(([name, text]) => {
    writeFileSync(join(workspaceRoot, name), text);
    return { uri: { scheme: "file", path: join(workspaceRoot, name) }, languageId: "css", text };
  });

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
      extensions: scanExtensions({ builtinDir: join(location.checkoutRoot, "extensions") }),
      myExtensions: ["vscode.css-language-features"],
      workspace: {
        id: "prac-css-test",
        name: "css-test",
        folders: [{ uri: { scheme: "file", path: workspaceRoot }, name: "css-test", index: 0 }],
      },
      documents,
      onLog: (message) => log.push(message),
      onUnhandledCall: ({ actor, method }) => log.push(`unhandled ${actor}.${method}`),
    },
    onOutput: (stream, chunk) => log.push(`${stream}: ${chunk.trim()}`),
  });
  cleanups.push(() => void host.dispose());

  const path = (name: string): string => join(workspaceRoot, name);
  const registration = async (kind: LanguageFeatureKind): Promise<number> => {
    await host.activateByEvent("onLanguage:css");
    await until(
      () => host.registrations.some((entry) => entry.kind === kind),
      `the css extension to register a ${kind} provider`,
      () =>
        `registrations: ${host.registrations.map((r) => r.kind).join(", ") || "(none)"}\nlog:\n${log.join("\n")}`,
    );
    return host.registrations.find((entry) => entry.kind === kind)!.handle;
  };

  return { host, workspaceRoot, log, path, registration };
}

describe.skipIf(!built)("main thread: the built-in css extension", () => {
  it("activates the extension and collects the providers it registers", async () => {
    const css = await startCssHost({ "style.css": "body {\n  color: red;\n}\n" });
    await css.registration("hover");
    // The language client registers a whole family, not just the one we ask for.
    expect(css.host.registrations.length).toBeGreaterThan(1);
    expect(css.host.child.exitCode).toBeNull();
    await css.host.dispose();
  }, 120_000);

  it("answers a hover from the language server the extension started", async () => {
    const text = "body {\n  color: red;\n}\n";
    const css = await startCssHost({ "hover.css": text });
    const handle = await css.registration("hover");
    // Zero-based position; the one-based conversion and the cancellation token
    // stay inside the module.
    const hover = await css.host.provideHover(
      handle,
      { scheme: "file", path: css.path("hover.css") },
      {
        line: 1,
        character: 3,
      },
    );
    // A real answer from the css language service: the hover for a property
    // documents the property, and nothing we wrote ourselves could know that.
    expect((hover?.contents ?? "").toLowerCase()).toContain("color");
    await css.host.dispose();
  }, 120_000);

  it("resolves a definition inside the document, on zero-based coordinates", async () => {
    // What this language service resolves a definition for is a symbol *within*
    // the document — a custom property here — not a cross-file import; the test
    // follows the provider rather than a guess about it.
    const css = await startCssHost({
      "vars.css": ":root {\n  --brand: red;\n}\n.a {\n  color: var(--brand);\n}\n",
    });
    const handle = await css.registration("definition");
    const locations = await css.host.provideDefinition(
      handle,
      { scheme: "file", path: css.path("vars.css") },
      // Inside the `--brand` of the `var(--brand)` usage on the fifth line.
      { line: 4, character: 16 },
    );
    expect(locations.length).toBeGreaterThan(0);
    const target = locations[0]!;
    expect(target.uri.path.endsWith("vars.css")).toBe(true);
    // …and it points back up at the declaration on the second line, zero-based.
    expect(target.range.start.line).toBe(1);
    await css.host.dispose();
  }, 120_000);

  it("answers references for a selector, mapped to zero-based ranges", async () => {
    const css = await startCssHost({
      "refs.css": ".a {\n  color: red;\n}\n\n.a {\n  color: blue;\n}\n",
    });
    const handle = await css.registration("references");
    const locations = await css.host.provideReferences(
      handle,
      { scheme: "file", path: css.path("refs.css") },
      { line: 0, character: 1 },
    );
    // The same selector occurs twice, and the provider points at both.
    expect(locations.length).toBeGreaterThan(1);
    expect(locations.every((location) => location.uri.path.endsWith("refs.css"))).toBe(true);
    expect(locations.map((location) => location.range.start.line).sort((a, b) => a - b)).toEqual([
      0, 4,
    ]);
    await css.host.dispose();
  }, 120_000);

  it("answers a second question about a document it already holds", async () => {
    // Regression: pushing the same document twice used to throw *inside* the
    // host ("document … already exists!") and take the host process with it, so
    // every question after the first one died with it.
    const css = await startCssHost({
      "twice.css": ":root {\n  --brand: red;\n}\n.a {\n  color: var(--brand);\n}\n",
    });
    const hover = await css.registration("hover");
    const uri = { scheme: "file", path: css.path("twice.css") };
    expect(
      (await css.host.provideHover(hover, uri, { line: 4, character: 9 }))?.contents,
    ).toContain("color");
    const definition = await css.registration("definition");
    const locations = await css.host.provideDefinition(definition, uri, { line: 4, character: 16 });
    expect(locations.length).toBeGreaterThan(0);
    expect(css.host.child.exitCode).toBeNull();
    await css.host.dispose();
  }, 120_000);

  it("shows the provider what the file says now, not what it said first", async () => {
    const css = await startCssHost({ "change.css": "body {\n  color: red;\n}\n" });
    const handle = await css.registration("hover");
    const uri = { scheme: "file", path: css.path("change.css") };
    // The same content again: no change to send, and the answer still comes.
    css.host.openDocument({ uri, languageId: "css", text: "body {\n  color: red;\n}\n" });
    expect(
      (await css.host.provideHover(handle, uri, { line: 1, character: 3 }))?.contents,
    ).toContain("color");

    // The file is rewritten (disk is the truth), so the mirror has to follow:
    // the old property is gone and the new one answers.
    const changed = "body {\n  display: flex;\n}\n";
    css.host.openDocument({ uri, languageId: "css", text: changed });
    const hover = await css.host.provideHover(handle, uri, { line: 1, character: 3 });
    expect((hover?.contents ?? "").toLowerCase()).toContain("display");
    expect(css.host.child.exitCode).toBeNull();
    await css.host.dispose();
  }, 120_000);
});
