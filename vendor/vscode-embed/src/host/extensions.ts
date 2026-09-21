/**
 * Reading extension manifests off disk into the descriptions the extension host
 * expects in its init data.
 *
 * Mechanism only: which directories are scanned and which extensions are
 * *ours* (`myExtensions`) stay with the consumer. Upstream has a scanner of its
 * own, but it is a service with a dozen dependencies; this one reads the
 * manifest, adds the fields the protocol requires and nothing else, so a
 * consumer can hand the result straight to the host.
 *
 * @module prac-vscode-embed/host/extensions
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** A URI in the shape the protocol's `UriComponents` uses. */
export interface ExtensionLocation {
  readonly scheme: string;
  readonly path: string;
}

/**
 * The subset of `IExtensionDescription` this package produces.
 *
 * Everything else in the manifest is carried through untouched: the host reads
 * `contributes`, `activationEvents` and `main` straight off the description, so
 * dropping fields here would silently change what an extension can do.
 */
export interface ExtensionDescription {
  readonly identifier: { readonly value: string; readonly _lower: string };
  readonly name: string;
  readonly publisher: string;
  readonly version: string;
  readonly engines: { readonly vscode: string };
  readonly main?: string;
  readonly browser?: string;
  readonly activationEvents?: readonly string[];
  readonly extensionLocation: ExtensionLocation;
  readonly isBuiltin: boolean;
  readonly isUserBuiltin: boolean;
  readonly isUnderDevelopment: boolean;
  readonly targetPlatform: string;
  readonly preRelease: boolean;
  readonly [manifestField: string]: unknown;
}

/**
 * Expand the configuration defaults a set of extensions declares.
 *
 * The protocol has no "here are the defaults" parameter: whatever
 * `workspace.getConfiguration()` returns comes from the init data we build, so
 * an extension's own `contributes.configuration` defaults have to be flattened
 * into it here — without them the extension reads `undefined` for its own
 * settings and quietly turns features off.
 *
 * `contributes.configurationDefaults` (the language-scoped `[css]` form) is
 * **not** carried: the model this package builds has no overrides layer. An
 * extension that depends on them reads its global default instead.
 */
export function configurationDefaults(
  descriptions: readonly ExtensionDescription[],
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const description of descriptions) {
    const contributes = description.contributes as { configuration?: unknown } | undefined;
    if (!contributes?.configuration) continue;
    // `contributes.configuration` is either one object or an array of them.
    const sections = Array.isArray(contributes.configuration)
      ? contributes.configuration
      : [contributes.configuration];
    for (const section of sections) {
      const properties = (section as { properties?: Record<string, unknown> } | undefined)
        ?.properties;
      if (!properties) continue;
      for (const [key, schema] of Object.entries(properties)) {
        if (schema && typeof schema === "object" && "default" in schema) {
          flat[key] = (schema as { default: unknown }).default;
        }
      }
    }
  }
  return flat;
}

/** An extension identifier in the shape that travels on the wire. */
export interface ExtensionIdentifierLike {
  readonly value: string;
  readonly _lower: string;
}

/**
 * What changed between two scans, in the shape the host applies.
 *
 * Mirrors `IExtensionDescriptionDelta`: the host rebuilds its registries from
 * it, so a caller that notices a new extension on disk can hand it to a host
 * that is already running instead of restarting that host.
 */
export interface ExtensionDescriptionDelta {
  readonly versionId: number;
  readonly toRemove: readonly ExtensionIdentifierLike[];
  readonly toAdd: readonly ExtensionDescription[];
  readonly addActivationEvents: Readonly<Record<string, readonly string[]>>;
  readonly myToRemove: readonly ExtensionIdentifierLike[];
  readonly myToAdd: readonly ExtensionIdentifierLike[];
}

/**
 * The difference between two scans, or `undefined` when there is none.
 *
 * Identity is the extension id; a known id whose `version` or location changed
 * counts as removed + added, which is what an updated package on disk is.
 * `undefined` for "nothing changed" is deliberate: a caller that re-scans
 * cheaply can then skip the round trip entirely.
 *
 * `isEnabled` is the consumer's policy for the *enabled* half of the wire: a
 * disabled extension still belongs to `allExtensions`, it just never becomes
 * "mine". The policy is fixed for a host's lifetime (our config is read when
 * the host starts), so it only has to filter what arrives — an extension that
 * stops being enabled is a new host, not a delta.
 *
 * @param previous - the scan the host already knows.
 * @param next - the scan to move it to.
 * @param versionId - the version the host should end up at.
 * @param isEnabled - whether an extension id is enabled, case-insensitively.
 * @returns the delta, or `undefined` when nothing differs.
 */
export function extensionsDelta(
  previous: readonly ExtensionDescription[],
  next: readonly ExtensionDescription[],
  versionId: number,
  isEnabled: (extensionId: string) => boolean,
): ExtensionDescriptionDelta | undefined {
  const before = new Map(previous.map((extension) => [extension.identifier._lower, extension]));
  const after = new Map(next.map((extension) => [extension.identifier._lower, extension]));
  const toRemove: ExtensionIdentifierLike[] = [];
  const toAdd: ExtensionDescription[] = [];
  const addActivationEvents: Record<string, readonly string[]> = {};

  for (const [key, extension] of before) {
    const replacement = after.get(key);
    if (replacement && samePackage(extension, replacement)) continue;
    toRemove.push(extension.identifier);
  }
  for (const [key, extension] of after) {
    const existing = before.get(key);
    if (existing && samePackage(existing, extension)) continue;
    toAdd.push(extension);
    addActivationEvents[extension.identifier.value] = extension.activationEvents ?? [];
  }
  if (toRemove.length === 0 && toAdd.length === 0) return undefined;
  return {
    versionId,
    toRemove,
    toAdd,
    addActivationEvents,
    // An extension that left the disk leaves the enabled half too; one that
    // arrived only joins it when the policy says so.
    myToRemove: toRemove,
    myToAdd: toAdd
      .filter((extension) => isEnabled(extension.identifier.value))
      .map((extension) => extension.identifier),
  };
}

/** Whether two descriptions are the same package as far as the host cares. */
function samePackage(a: ExtensionDescription, b: ExtensionDescription): boolean {
  return a.version === b.version && a.extensionLocation.path === b.extensionLocation.path;
}

export interface ScanExtensionsOptions {
  /** Built-in extensions (`<checkout>/extensions`). */
  readonly builtinDir: string;
  /** Installed extensions, scanned the same way but not marked built-in. */
  readonly userDir?: string;
}

/**
 * Scan extension directories, in order, skipping whatever is not an extension.
 *
 * A directory counts as an extension when its `package.json` has a `name`, a
 * `publisher` and an `engines.vscode` range — the three fields upstream refuses
 * to load without. Anything else (a partially unpacked download, a stray
 * directory) is skipped rather than being handed to the host, where it would
 * fail activation later with a much worse error.
 */
export function scanExtensions(options: ScanExtensionsOptions): ExtensionDescription[] {
  const found: ExtensionDescription[] = [];
  const seen = new Set<string>();
  for (const [directory, isBuiltin] of [
    [options.builtinDir, true],
    [options.userDir, false],
  ] as const) {
    if (!directory) continue;
    for (const description of scanDirectory(directory, isBuiltin)) {
      const key = description.identifier._lower;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(description);
    }
  }
  return found;
}

function scanDirectory(directory: string, isBuiltin: boolean): ExtensionDescription[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const found: ExtensionDescription[] = [];
  for (const entry of entries.sort()) {
    const path = join(directory, entry);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    const description = readExtensionDescription(path, isBuiltin);
    if (description) found.push(description);
  }
  return found;
}

/**
 * Read one extension directory, or `undefined` when it is not one.
 *
 * `isBuiltin` is the caller's judgement (which directory it came from), not
 * something the manifest says.
 */
export function readExtensionDescription(
  extensionPath: string,
  isBuiltin: boolean,
): ExtensionDescription | undefined {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(extensionPath, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
  const name = typeof manifest.name === "string" ? manifest.name : undefined;
  const publisher = typeof manifest.publisher === "string" ? manifest.publisher : undefined;
  const engines = manifest.engines as { vscode?: unknown } | undefined;
  const vscode = typeof engines?.vscode === "string" ? engines.vscode : undefined;
  if (!name || !publisher || !vscode) return undefined;

  const value = `${publisher}.${name}`;
  const location = resolve(extensionPath);
  return {
    ...manifest,
    identifier: { value, _lower: value.toLowerCase() },
    isBuiltin,
    isUserBuiltin: false,
    isUnderDevelopment: false,
    // Upstream's `TargetPlatform.UNDEFINED`; a platform-specific build would say
    // otherwise, and nothing in the manifest does.
    targetPlatform: "undefined",
    preRelease: false,
    extensionLocation: { scheme: "file", path: location },
  } as unknown as ExtensionDescription;
}
