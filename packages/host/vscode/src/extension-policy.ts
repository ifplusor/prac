/**
 * Which VS Code extensions the agent side enables — prac's own policy, in a
 * file we own.
 *
 * Why we keep a list at all: the agent is a **server-side** consumer, and the
 * enablement VS Code itself computes is client-side in every form we ship
 * (`docs/architecture.md` §7 #4) — so there is nothing to read on this side.
 * Rather than mirror the interface the browser happens to have, prac states its
 * own policy, and the shapes mirror upstream's two scopes so the semantics stay
 * expressible:
 *
 * - `disabled` is the **global** layer, which is what upstream's
 *   `IGlobalExtensionEnablementService` reads (`extensionsIdentifiers/disabled`
 *   in global storage);
 * - `workspaces[root]` is the **workspace** layer, which upstream reads from
 *   workspace storage when the window has a workspace, and which may also
 *   `enable` an extension that the global layer disabled.
 *
 * Selection follows upstream's own order
 * (`workbench/services/extensionManagement/browser/extensionEnablementService.ts:634-661`):
 * workspace `enabled`, then workspace `disabled`, then global `disabled`, and
 * otherwise **enabled**. So an absent file, an empty file, or a workspace with
 * no entry all mean "whatever is installed" — the same place upstream's ladder
 * lands when nothing says otherwise.
 *
 * The file is **configuration** (`$XDG_CONFIG_HOME/prac/extensions.json`): a
 * decision a human or an agent can read and edit, not a record of what happened
 * last time.
 *
 * @module prac-host-vscode/extension-policy
 */

import { readFileSync } from "node:fs";

/** One workspace's override, mirroring upstream's workspace scope. */
export interface WorkspaceExtensionOverride {
  /** Extension ids this workspace turns off (`publisher.name`). */
  readonly disabled: readonly string[];
  /** Extension ids this workspace turns on, overriding the global layer. */
  readonly enabled: readonly string[];
}

/** prac's enablement policy for the agent side. */
export interface ExtensionPolicy {
  /** Extension ids off everywhere on the agent side. */
  readonly disabled: readonly string[];
  /** Overrides per workspace root, keyed by absolute path. */
  readonly workspaces: Readonly<Record<string, WorkspaceExtensionOverride>>;
}

/** The policy that disables nothing: what an absent or unusable file means. */
export const NO_EXTENSION_POLICY: ExtensionPolicy = { disabled: [], workspaces: {} };

/**
 * Read the policy file.
 *
 * A missing file is not a problem — it is the normal state of a fresh install,
 * and it means "nothing is disabled". A file that cannot be read or parsed is
 * reported and then treated as missing: a typo in configuration must not be
 * able to switch a workspace's extensions off silently, which is the direction
 * a "fail closed" reading would go.
 *
 * @param path - absolute path of the policy file.
 * @param report - where problems go; defaults to `console.warn`.
 * @returns the policy, with unknown shapes dropped rather than guessed at.
 */
export function readExtensionPolicy(
  path: string,
  report: (message: string) => void = console.warn,
): ExtensionPolicy {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") report(`${path}: ${message(error)} — enabling everything`);
    return NO_EXTENSION_POLICY;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    report(`${path}: not JSON (${message(error)}) — enabling everything`);
    return NO_EXTENSION_POLICY;
  }
  if (!isRecord(parsed)) {
    report(`${path}: expected an object — enabling everything`);
    return NO_EXTENSION_POLICY;
  }

  const workspaces: Record<string, WorkspaceExtensionOverride> = {};
  const rawWorkspaces = parsed.workspaces;
  if (rawWorkspaces !== undefined && isRecord(rawWorkspaces)) {
    for (const [root, override] of Object.entries(rawWorkspaces)) {
      if (!isRecord(override)) {
        report(`${path}: workspaces["${root}"] is not an object — ignoring it`);
        continue;
      }
      workspaces[root] = {
        disabled: identifiers(path, `workspaces["${root}"].disabled`, override.disabled, report),
        enabled: identifiers(path, `workspaces["${root}"].enabled`, override.enabled, report),
      };
    }
  } else if (rawWorkspaces !== undefined) {
    report(`${path}: "workspaces" is not an object — ignoring it`);
  }

  return {
    disabled: identifiers(path, "disabled", parsed.disabled, report),
    workspaces,
  };
}

/**
 * Whether the agent side enables one extension in one workspace.
 *
 * The order is upstream's: the workspace layer may turn an extension on over a
 * global disable, and otherwise the global list decides.
 *
 * @param policy - the policy as read.
 * @param workspaceRoot - absolute path of the workspace the host serves.
 * @param id - extension id (`publisher.name`), matched case-insensitively as
 * upstream's own comparison does.
 * @returns whether the host should be told this extension is enabled.
 */
export function isExtensionEnabled(
  policy: ExtensionPolicy,
  workspaceRoot: string,
  id: string,
): boolean {
  const wanted = id.toLowerCase();
  const includes = (list: readonly string[]): boolean =>
    list.some((entry) => entry.toLowerCase() === wanted);
  const override = policy.workspaces[workspaceRoot];
  if (override !== undefined) {
    if (includes(override.enabled)) return true;
    if (includes(override.disabled)) return false;
  }
  return !includes(policy.disabled);
}

/** The enabled subset of a scan, in the scan's own order. */
export function enabledExtensionIds(
  policy: ExtensionPolicy,
  workspaceRoot: string,
  ids: readonly string[],
): readonly string[] {
  return ids.filter((id) => isExtensionEnabled(policy, workspaceRoot, id));
}

/** Read a list of extension ids, keeping only the strings. */
function identifiers(
  path: string,
  field: string,
  value: unknown,
  report: (message: string) => void,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(`${path}: "${field}" is not an array — ignoring it`);
    return [];
  }
  const ids = value.filter((entry): entry is string => typeof entry === "string");
  if (ids.length !== value.length) {
    report(`${path}: "${field}" has entries that are not strings — dropping them`);
  }
  return ids;
}

/** Whether a parsed value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An error's message, for a report line. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
