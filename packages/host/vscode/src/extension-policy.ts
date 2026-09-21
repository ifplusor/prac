/**
 * Which VS Code extensions the agent side enables — prac's own policy, in files
 * of our own that are **isomorphic to VS Code's configuration model** (James
 * 2026-09-21: keep the agent's configuration separate from the UI's, but give it
 * the same shape).
 *
 * Isomorphic means all four of these, so that the model is one a VS Code user
 * already knows:
 *
 * - **Scopes.** VS Code has a global layer and a workspace layer; so do we —
 *   `globalPath` (our user settings) and `workspacePath` (`<workspace>/.prac/
 *   settings.json`, the counterpart of `.vscode/settings.json`).
 * - **Format.** A JSONC `settings.json`: comments and trailing commas are legal,
 *   parsed by VS Code's own parser (`readSettingsJson` in `prac-vscode-embed`).
 * - **Keys.** Dotted setting ids, read from a flat object —
 *   `prac.extensions.disabled` and `prac.extensions.enabled`.
 * - **Precedence.** Upstream's ladder, unchanged: workspace `enabled` →
 *   workspace `disabled` → global `disabled` → otherwise enabled
 *   (`workbench/services/extensionManagement/browser/extensionEnablementService.ts:634-661`).
 *
 * Separate means the files are **ours**: we do not write into VS Code's
 * `settings.json`, because the UI's own enablement is client-side state that we
 * cannot see and do not mirror (`docs/architecture.md` §7 #4).
 *
 * There is still no "which extensions exist" list here, and no allowlist: an
 * absent file, an empty file, or a workspace with no file all mean "whatever is
 * installed", the same place upstream's ladder lands when nothing says otherwise.
 *
 * @module prac-host-vscode/extension-policy
 */

import type { SettingsRead } from "prac-vscode-embed";

/** The setting ids we read, named as a VS Code setting would be. */
export const EXTENSION_SETTINGS = {
  disabled: "prac.extensions.disabled",
  enabled: "prac.extensions.enabled",
} as const;

/** One settings file's worth of enablement, both directions. */
export interface ExtensionLayer {
  /** Extension ids this layer turns off (`publisher.name`). */
  readonly disabled: readonly string[];
  /** Extension ids this layer turns on, which may override a disable below. */
  readonly enabled: readonly string[];
}

/** The policy in force for one workspace. */
export interface ExtensionPolicy {
  /** The global layer: our user-level settings file. */
  readonly global: ExtensionLayer;
  /** The workspace layer: the workspace's own settings file. */
  readonly workspace: ExtensionLayer;
  /** The files the two layers were read from, for logs and messages. */
  readonly files: { readonly global: string; readonly workspace: string };
}

/** The policy that disables nothing: what absent or unusable files mean. */
export const NO_EXTENSION_POLICY: ExtensionLayer = { disabled: [], enabled: [] };

/** Reads one settings file; `readSettingsJson` satisfies this. */
export type SettingsReader = (path: string) => Promise<SettingsRead>;

/**
 * Read both layers of the policy.
 *
 * A file that cannot be read or parsed is reported and then treated as absent,
 * so a typo cannot switch a workspace's extensions off silently — that is the
 * direction a "fail closed" reading would go, and it is the worse failure.
 *
 * @param read - how to read a settings file (VS Code's own parser, injected so
 * this module stays testable without a build).
 * @param files - absolute paths of the global and workspace settings files.
 * @param report - where problems go; defaults to `console.warn`.
 * @returns the policy in force for that workspace.
 */
export async function readExtensionPolicy(
  read: SettingsReader,
  files: { readonly global: string; readonly workspace: string },
  report: (message: string) => void = console.warn,
): Promise<ExtensionPolicy> {
  const [global, workspace] = await Promise.all([read(files.global), read(files.workspace)]);
  for (const problem of [...global.problems, ...workspace.problems]) report(problem);
  return {
    global: layerFrom(global.settings, files.global, report),
    workspace: layerFrom(workspace.settings, files.workspace, report),
    files,
  };
}

/**
 * Whether one extension is enabled for the workspace this policy describes.
 *
 * The order is upstream's: the workspace layer may turn an extension on over a
 * global disable, and otherwise the global list decides.
 *
 * @param policy - the policy as read.
 * @param id - extension id (`publisher.name`), matched case-insensitively as
 * upstream's own comparison does.
 * @returns whether the host should be told this extension is enabled.
 */
export function isExtensionEnabled(policy: ExtensionPolicy, id: string): boolean {
  const wanted = id.toLowerCase();
  const includes = (list: readonly string[]): boolean =>
    list.some((entry) => entry.toLowerCase() === wanted);
  if (includes(policy.workspace.enabled)) return true;
  if (includes(policy.workspace.disabled)) return false;
  return !includes(policy.global.disabled);
}

/** The enabled subset of a scan, in the scan's own order. */
export function enabledExtensionIds(
  policy: ExtensionPolicy,
  ids: readonly string[],
): readonly string[] {
  return ids.filter((id) => isExtensionEnabled(policy, id));
}

/** Read one layer's two lists out of a settings object. */
function layerFrom(
  settings: Record<string, unknown>,
  path: string,
  report: (message: string) => void,
): ExtensionLayer {
  return {
    disabled: identifiers(
      settings[EXTENSION_SETTINGS.disabled],
      path,
      EXTENSION_SETTINGS.disabled,
      report,
    ),
    enabled: identifiers(
      settings[EXTENSION_SETTINGS.enabled],
      path,
      EXTENSION_SETTINGS.enabled,
      report,
    ),
  };
}

/** Read a list of extension ids, keeping only the strings. */
function identifiers(
  value: unknown,
  path: string,
  key: string,
  report: (message: string) => void,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(`${path}: "${key}" is not an array — ignoring it`);
    return [];
  }
  const ids = value.filter((entry): entry is string => typeof entry === "string");
  if (ids.length !== value.length) {
    report(`${path}: "${key}" has entries that are not ids — dropping them`);
  }
  return ids;
}
