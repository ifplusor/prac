/**
 * Reading a VS Code `settings.json`, with VS Code's **own** parser.
 *
 * This exists so a consumer can keep its configuration model isomorphic to VS
 * Code's without re-implementing one detail that is easy to get subtly wrong:
 * a settings file is **JSONC** — comments and trailing commas are legal, and
 * upstream parses it with `allowTrailingComma` (the parser's own default) while
 * leaving comments on. A plain `JSON.parse` would reject files a VS Code user
 * writes without thinking.
 *
 * Mechanism only: which files to read, and what the values mean, stay with the
 * consumer.
 *
 * @module prac-vscode-embed/host/settings
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionHostLocation } from "./extension-host.js";

/** What one settings file yielded, and what was wrong with it. */
export interface SettingsRead {
  /** The settings the file holds; `{}` when it is absent or unusable. */
  readonly settings: Record<string, unknown>;
  /** Problems, each already naming the file — empty when there were none. */
  readonly problems: readonly string[];
}

/**
 * Read one settings file.
 *
 * A missing file is not a problem: it is the normal state of a fresh install,
 * and the caller's own defaults decide what that means. A file that exists but
 * cannot be read or parsed **is** reported, and yields no settings — the caller
 * should then behave as if the file were absent, because a typo must not be able
 * to switch configuration off silently.
 *
 * @param location - the resolved build, whose own parser is used.
 * @param path - absolute path of the settings file.
 * @returns the settings, plus anything worth telling the user.
 */
export async function readSettingsJson(
  location: ExtensionHostLocation,
  path: string,
): Promise<SettingsRead> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { settings: {}, problems: [] };
    return { settings: {}, problems: [`${path}: ${message(error)}`] };
  }

  const json = await import(pathToFileURL(join(location.outBuild, "vs/base/common/json.js")).href);
  const errors: { error: number; offset: number; length: number }[] = [];
  let parsed: unknown;
  try {
    parsed = json.parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true });
  } catch (error) {
    return { settings: {}, problems: [`${path}: ${message(error)}`] };
  }
  if (errors.length > 0) {
    const first = errors[0];
    return {
      settings: {},
      problems: [
        `${path}: not valid JSONC (${errors.length} problem(s); first is code ${first.error} ` +
          `at offset ${first.offset})`,
      ],
    };
  }
  if (parsed === undefined || parsed === null) return { settings: {}, problems: [] };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { settings: {}, problems: [`${path}: expected an object of settings`] };
  }
  return { settings: parsed as Record<string, unknown>, problems: [] };
}

/** An error's message, for a report line. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
