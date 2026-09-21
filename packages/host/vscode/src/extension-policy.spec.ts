/**
 * The agent side's enablement policy: reading it, and the order it decides in.
 *
 * The interesting cases are all about *not* disabling things by accident — an
 * absent file, a typo, a half-written edit — because the failure mode of a
 * stricter reading is a workspace that quietly loses capabilities.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  enabledExtensionIds,
  isExtensionEnabled,
  NO_EXTENSION_POLICY,
  readExtensionPolicy,
} from "./extension-policy.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Write a policy file into a scratch directory and return its path. */
function policyFile(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "prac-extensions-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "extensions.json");
  writeFileSync(path, content);
  return path;
}

/** Read a policy, collecting what it reported instead of printing it. */
function read(path: string): {
  policy: ReturnType<typeof readExtensionPolicy>;
  problems: string[];
} {
  const problems: string[] = [];
  const policy = readExtensionPolicy(path, (message) => problems.push(message));
  return { policy, problems };
}

describe("readExtensionPolicy", () => {
  it("treats a missing file as 'nothing is disabled'", () => {
    const root = mkdtempSync(join(tmpdir(), "prac-extensions-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const { policy, problems } = read(join(root, "extensions.json"));
    expect(policy).toEqual(NO_EXTENSION_POLICY);
    expect(problems).toEqual([]);
  });

  it("reads a global disable list and a per-workspace override", () => {
    const path = policyFile(
      JSON.stringify({
        disabled: ["publisher.global"],
        workspaces: {
          "/work/one": { disabled: ["publisher.here"], enabled: ["publisher.back"] },
        },
      }),
    );
    const { policy, problems } = read(path);
    expect(problems).toEqual([]);
    expect(policy.disabled).toEqual(["publisher.global"]);
    expect(policy.workspaces["/work/one"]).toEqual({
      disabled: ["publisher.here"],
      enabled: ["publisher.back"],
    });
  });

  it("treats an empty object as an empty policy", () => {
    const { policy, problems } = read(policyFile("{}"));
    expect(policy).toEqual(NO_EXTENSION_POLICY);
    expect(problems).toEqual([]);
  });

  it("enables everything when the file cannot be parsed, and says so", () => {
    const { policy, problems } = read(policyFile("{ this is not json"));
    expect(policy).toEqual(NO_EXTENSION_POLICY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not JSON");
  });

  it("enables everything when the file is not an object, and says so", () => {
    const { policy, problems } = read(policyFile('["publisher.ext"]'));
    expect(policy).toEqual(NO_EXTENSION_POLICY);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("expected an object");
  });

  it("drops entries that are not ids, and reports the field", () => {
    const { policy, problems } = read(
      policyFile(JSON.stringify({ disabled: ["publisher.ok", 42, null] })),
    );
    expect(policy.disabled).toEqual(["publisher.ok"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"disabled"');
  });

  it("ignores a workspace entry that is not an object, and reports it", () => {
    const { policy, problems } = read(
      policyFile(JSON.stringify({ workspaces: { "/work/one": "all", "/work/two": {} } })),
    );
    expect(Object.keys(policy.workspaces)).toEqual(["/work/two"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('workspaces["/work/one"]');
  });
});

describe("isExtensionEnabled", () => {
  const policy = {
    disabled: ["publisher.off"],
    workspaces: {
      "/work/one": { disabled: ["publisher.here"], enabled: ["publisher.off", "publisher.back"] },
    },
  };

  it("uses upstream's order: workspace enabled, workspace disabled, global, else on", () => {
    // Enabled by the workspace even though the global list disables it.
    expect(isExtensionEnabled(policy, "/work/one", "publisher.off")).toBe(true);
    expect(isExtensionEnabled(policy, "/work/one", "publisher.back")).toBe(true);
    expect(isExtensionEnabled(policy, "/work/one", "publisher.here")).toBe(false);
    // Globally off, and this workspace says nothing about it.
    expect(isExtensionEnabled(policy, "/work/two", "publisher.off")).toBe(false);
    // Nothing anywhere says a word about it.
    expect(isExtensionEnabled(policy, "/work/two", "publisher.whatever")).toBe(true);
  });

  it("matches ids case-insensitively, as upstream's own comparison does", () => {
    expect(isExtensionEnabled(policy, "/work/two", "Publisher.OFF")).toBe(false);
    expect(isExtensionEnabled(policy, "/work/one", "PUBLISHER.HERE")).toBe(false);
  });

  it("keeps one workspace's override out of another", () => {
    expect(isExtensionEnabled(policy, "/work/one", "publisher.here")).toBe(false);
    expect(isExtensionEnabled(policy, "/work/two", "publisher.here")).toBe(true);
  });

  it("disables nothing when there is no policy", () => {
    expect(isExtensionEnabled(NO_EXTENSION_POLICY, "/work/one", "publisher.any")).toBe(true);
  });
});

describe("enabledExtensionIds", () => {
  it("keeps the scan's own order and drops what the policy turns off", () => {
    const policy = { disabled: ["b.two"], workspaces: {} };
    expect(enabledExtensionIds(policy, "/work/one", ["a.one", "b.two", "c.three"])).toEqual([
      "a.one",
      "c.three",
    ]);
  });
});
