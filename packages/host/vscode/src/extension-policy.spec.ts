/**
 * The agent side's enablement policy: the two layers, and the order they decide in.
 *
 * The interesting cases are all about *not* disabling things by accident — an
 * absent file, a typo, a value of the wrong shape — because the failure mode of
 * a stricter reading is a workspace that quietly loses capabilities.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  enabledExtensionIds,
  isExtensionEnabled,
  readExtensionPolicy,
  type ExtensionPolicy,
  type SettingsReader,
} from "./extension-policy.js";

const GLOBAL = "/home/user/.config/prac/settings.json";
const WORKSPACE = "/work/one/.agent/prac/settings.json";
const OTHER_WORKSPACE = "/work/two/.agent/prac/settings.json";

/** A reader over an in-memory settings file set. */
function reader(
  files: Record<string, Record<string, unknown>>,
  problems: Record<string, readonly string[]> = {},
): SettingsReader {
  return async (path) => ({ settings: files[path] ?? {}, problems: problems[path] ?? [] });
}

/** Read a policy from a global file and a workspace file. */
async function policyWith(
  global: Record<string, unknown>,
  workspace: Record<string, unknown> = {},
  report: (message: string) => void = () => undefined,
): Promise<ExtensionPolicy> {
  return readExtensionPolicy(
    reader({ [GLOBAL]: global, [WORKSPACE]: workspace }),
    { global: GLOBAL, workspace: WORKSPACE },
    report,
  );
}

describe("readExtensionPolicy", () => {
  it("disables nothing when neither file exists", async () => {
    const policy = await readExtensionPolicy(reader({}), { global: GLOBAL, workspace: WORKSPACE });
    expect(policy.global).toEqual({ disabled: [], enabled: [] });
    expect(policy.workspace).toEqual({ disabled: [], enabled: [] });
    expect(isExtensionEnabled(policy, "publisher.any")).toBe(true);
  });

  it("reads the global and the workspace layer from their own files", async () => {
    const policy = await policyWith(
      { "extensionsIdentifiers/disabled": ["publisher.global"] },
      {
        "extensionsIdentifiers/disabled": ["publisher.here"],
        "extensionsIdentifiers/enabled": ["publisher.back"],
      },
    );
    expect(policy.global).toEqual({ disabled: ["publisher.global"], enabled: [] });
    expect(policy.workspace).toEqual({ disabled: ["publisher.here"], enabled: ["publisher.back"] });
    expect(policy.files).toEqual({ global: GLOBAL, workspace: WORKSPACE });
  });

  it("reports what the reader found wrong with a file, and keeps going", async () => {
    const seen: string[] = [];
    const policy = await readExtensionPolicy(
      reader(
        { [GLOBAL]: { "extensionsIdentifiers/disabled": ["publisher.global"] } },
        { [GLOBAL]: ["/path/settings.json: not valid JSONC"] },
      ),
      { global: GLOBAL, workspace: WORKSPACE },
      (message) => seen.push(message),
    );
    // The layer still holds what was readable, and the problem was passed on.
    expect(policy.global.disabled).toEqual(["publisher.global"]);
    expect(seen).toEqual(["/path/settings.json: not valid JSONC"]);
  });

  it("ignores a value that is not an array, and says which key", async () => {
    const seen: string[] = [];
    const policy = await policyWith(
      { "extensionsIdentifiers/disabled": "publisher.one" },
      {},
      (message) => seen.push(message),
    );
    expect(policy.global.disabled).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(GLOBAL);
    expect(seen[0]).toContain("extensionsIdentifiers/disabled");
  });

  it("drops entries that are not ids, and reports the key", async () => {
    const seen: string[] = [];
    const policy = await policyWith(
      { "extensionsIdentifiers/disabled": ["publisher.ok", 42, null] },
      {},
      (message) => seen.push(message),
    );
    expect(policy.global.disabled).toEqual(["publisher.ok"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("extensionsIdentifiers/disabled");
  });
});

describe("isExtensionEnabled", () => {
  it("uses upstream's order: workspace enabled, workspace disabled, global, else on", async () => {
    const policy = await policyWith(
      { "extensionsIdentifiers/disabled": ["publisher.off"] },
      {
        "extensionsIdentifiers/disabled": ["publisher.here"],
        "extensionsIdentifiers/enabled": ["publisher.off", "publisher.back"],
      },
    );
    // Enabled by the workspace even though the global layer disables it.
    expect(isExtensionEnabled(policy, "publisher.off")).toBe(true);
    expect(isExtensionEnabled(policy, "publisher.back")).toBe(true);
    expect(isExtensionEnabled(policy, "publisher.here")).toBe(false);
    expect(isExtensionEnabled(policy, "publisher.whatever")).toBe(true);
  });

  it("matches ids case-insensitively, as upstream's own comparison does", async () => {
    const policy = await policyWith(
      { "extensionsIdentifiers/disabled": ["publisher.off"] },
      { "extensionsIdentifiers/disabled": ["publisher.here"] },
    );
    expect(isExtensionEnabled(policy, "Publisher.OFF")).toBe(false);
    expect(isExtensionEnabled(policy, "PUBLISHER.HERE")).toBe(false);
    expect(isExtensionEnabled(policy, "publisher.OTHER")).toBe(true);
  });

  it("keeps one workspace's layer out of another's", async () => {
    const one = await policyWith({}, { "extensionsIdentifiers/disabled": ["publisher.here"] });
    const two = await readExtensionPolicy(reader({ [OTHER_WORKSPACE]: {} }), {
      global: GLOBAL,
      workspace: OTHER_WORKSPACE,
    });
    expect(isExtensionEnabled(one, "publisher.here")).toBe(false);
    expect(isExtensionEnabled(two, "publisher.here")).toBe(true);
  });
});

describe("enabledExtensionIds", () => {
  it("keeps the scan's own order and drops what the policy turns off", async () => {
    const policy = await policyWith({ "extensionsIdentifiers/disabled": ["b.two"] });
    expect(enabledExtensionIds(policy, ["a.one", "b.two", "c.three"])).toEqual([
      "a.one",
      "c.three",
    ]);
  });
});
