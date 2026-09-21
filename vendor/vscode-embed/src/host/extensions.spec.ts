/**
 * Tests for manifest scanning.
 *
 * The scanner is what turns a directory into something the extension host will
 * load, so the assertions are about what it refuses (no name / publisher /
 * engine range) as much as about what it produces.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  configurationDefaults,
  extensionsDelta,
  readExtensionDescription,
  scanExtensions,
} from "./extensions.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "prac-ext-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** An extension directory holding the given manifest. */
function extension(root: string, folder: string, manifest: Record<string, unknown>): string {
  const path = join(root, folder);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify(manifest));
  return path;
}

const CSS = {
  name: "css-language-features",
  publisher: "vscode",
  version: "10.0.0",
  engines: { vscode: "^1.77.0" },
  main: "./client/out/node/cssClientMain",
  activationEvents: ["onLanguage:css"],
};

describe("readExtensionDescription", () => {
  it("adds the fields the protocol needs to the manifest", () => {
    const root = scratch();
    const path = extension(root, "css-language-features", CSS);
    const description = readExtensionDescription(path, true);
    expect(description?.identifier).toEqual({
      value: "vscode.css-language-features",
      _lower: "vscode.css-language-features",
    });
    expect(description?.isBuiltin).toBe(true);
    expect(description?.isUserBuiltin).toBe(false);
    expect(description?.isUnderDevelopment).toBe(false);
    expect(description?.extensionLocation).toEqual({ scheme: "file", path });
    // Manifest fields travel untouched: the host reads them off the description.
    expect(description?.main).toBe("./client/out/node/cssClientMain");
    expect(description?.activationEvents).toEqual(["onLanguage:css"]);
  });

  it("refuses a directory that is not an extension", () => {
    const root = scratch();
    expect(readExtensionDescription(join(root, "missing"), true)).toBeUndefined();
    const noEngine = extension(root, "no-engine", { name: "a", publisher: "b" });
    expect(readExtensionDescription(noEngine, true)).toBeUndefined();
    const noPublisher = extension(root, "no-publisher", {
      name: "a",
      engines: { vscode: "^1.0.0" },
    });
    expect(readExtensionDescription(noPublisher, true)).toBeUndefined();
  });
});

describe("scanExtensions", () => {
  it("scans built-ins and installed extensions, built-ins first", () => {
    const builtin = scratch();
    const user = scratch();
    extension(builtin, "css-language-features", CSS);
    extension(user, "code-spell-checker", {
      name: "code-spell-checker",
      publisher: "streetsidesoftware",
      version: "4.9.3",
      engines: { vscode: "^1.60.0" },
    });
    mkdirSync(join(user, "not-an-extension"));
    const found = scanExtensions({ builtinDir: builtin, userDir: user });
    expect(found.map((extension) => extension.identifier.value)).toEqual([
      "vscode.css-language-features",
      "streetsidesoftware.code-spell-checker",
    ]);
    expect(found.map((extension) => extension.isBuiltin)).toEqual([true, false]);
  });

  it("lets a built-in win over an installed copy of the same id", () => {
    const builtin = scratch();
    const user = scratch();
    extension(builtin, "css-language-features", CSS);
    extension(user, "css-language-features", { ...CSS, version: "9.0.0" });
    const found = scanExtensions({ builtinDir: builtin, userDir: user });
    expect(found).toHaveLength(1);
    expect(found[0]?.version).toBe("10.0.0");
  });

  it("survives a directory that does not exist", () => {
    const builtin = scratch();
    extension(builtin, "css-language-features", CSS);
    expect(scanExtensions({ builtinDir: builtin, userDir: join(builtin, "nope") })).toHaveLength(1);
  });
});

describe("extensionsDelta", () => {
  const description = (value: string, version = "1.0.0", path = `/ext/${value}`) =>
    ({
      ...CSS,
      identifier: { value, _lower: value },
      version,
      extensionLocation: { scheme: "file", path },
    }) as unknown as Parameters<typeof extensionsDelta>[0][number];

  it("says nothing when nothing changed", () => {
    const one = description("a.one");
    expect(extensionsDelta([one], [description("a.one")], 2)).toBeUndefined();
  });

  it("adds what appeared, with its activation events", () => {
    const delta = extensionsDelta([], [description("a.one")], 2);
    expect(delta?.toAdd.map((extension) => extension.identifier.value)).toEqual(["a.one"]);
    expect(delta?.addActivationEvents).toEqual({ "a.one": ["onLanguage:css"] });
    expect(delta?.myToAdd).toEqual([{ value: "a.one", _lower: "a.one" }]);
    expect(delta?.versionId).toBe(2);
  });

  it("removes what disappeared", () => {
    const delta = extensionsDelta([description("a.one")], [], 2);
    expect(delta?.toRemove).toEqual([{ value: "a.one", _lower: "a.one" }]);
    expect(delta?.myToRemove).toEqual([{ value: "a.one", _lower: "a.one" }]);
    expect(delta?.toAdd).toEqual([]);
  });

  it("treats a new version or a new location as a replacement", () => {
    const replaced = extensionsDelta(
      [description("a.one", "1.0.0")],
      [description("a.one", "2.0.0")],
      2,
    );
    expect(replaced?.toRemove.map((id) => id.value)).toEqual(["a.one"]);
    expect(replaced?.toAdd.map((extension) => extension.version)).toEqual(["2.0.0"]);

    const moved = extensionsDelta(
      [description("a.one", "1.0.0", "/ext/old")],
      [description("a.one", "1.0.0", "/ext/new")],
      2,
    );
    expect(moved?.toRemove.map((id) => id.value)).toEqual(["a.one"]);
  });
});

describe("configurationDefaults", () => {
  it("flattens declared defaults, including defaults nested in an array section", () => {
    const root = scratch();
    const path = extension(root, "ext", {
      ...CSS,
      contributes: {
        configuration: [
          { properties: { "css.format.enable": { type: "boolean", default: true } } },
          { properties: { "css.hover.documentation": { type: "boolean" } } },
        ],
      },
    });
    const description = readExtensionDescription(path, true)!;
    expect(configurationDefaults([description])).toEqual({ "css.format.enable": true });
  });

  it("returns nothing for an extension that declares no configuration", () => {
    const root = scratch();
    const description = readExtensionDescription(extension(root, "ext", CSS), true)!;
    expect(configurationDefaults([description])).toEqual({});
  });
});
