/**
 * Reading a `settings.json` the way VS Code does.
 *
 * The point of these cases is the *tolerance*: a settings file a person writes
 * may carry comments and trailing commas, and a reader that rejects those would
 * be subtly wrong in a way users notice immediately.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveExtensionHost } from "./extension-host.js";
import { readSettingsJson } from "./settings.js";

const location = resolveExtensionHost({ from: fileURLToPath(new URL(".", import.meta.url)) });
const built = existsSync(join(location.outBuild, "vs/base/common/json.js"));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Write a file into a scratch directory and return its path. */
function scratch(name: string, content: string): string {
  const root = mkdtempSync(join(tmpdir(), "prac-settings-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
}

describe("readSettingsJson", () => {
  it("treats a missing file as no settings and no problem", async () => {
    const root = mkdtempSync(join(tmpdir(), "prac-settings-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    expect(await readSettingsJson(location, join(root, "settings.json"))).toEqual({
      settings: {},
      problems: [],
    });
  });

  it.skipIf(!built)("accepts comments and trailing commas, as VS Code does", async () => {
    const path = scratch(
      "settings.json",
      `{
  // why this workspace does not want it
  "prac.extensions.disabled": ["publisher.noisy",],
}
`,
    );
    const read = await readSettingsJson(location, path);
    expect(read.problems).toEqual([]);
    expect(read.settings).toEqual({ "prac.extensions.disabled": ["publisher.noisy"] });
  });

  it.skipIf(!built)(
    "reports a file that is not valid JSONC, with nothing read from it",
    async () => {
      const path = scratch("settings.json", `{ "prac.extensions.disabled": [ oops`);
      const read = await readSettingsJson(location, path);
      expect(read.settings).toEqual({});
      expect(read.problems).toHaveLength(1);
      expect(read.problems[0]).toContain(path);
      expect(read.problems[0]).toContain("not valid JSONC");
    },
  );

  it.skipIf(!built)("reports a file that is not an object of settings", async () => {
    const path = scratch("settings.json", `["prac.extensions.disabled"]`);
    const read = await readSettingsJson(location, path);
    expect(read.settings).toEqual({});
    expect(read.problems).toEqual([`${path}: expected an object of settings`]);
  });

  it.skipIf(!built)("treats an empty file as no settings", async () => {
    const path = scratch("settings.json", "   \n");
    expect(await readSettingsJson(location, path)).toEqual({ settings: {}, problems: [] });
  });
});
