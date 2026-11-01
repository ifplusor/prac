import { describe, expect, it } from "vite-plus/test";
import { coordinate, readTurnDiff, repoPath } from "./turn-diff.ts";

describe("coordinate", () => {
  it("accepts non-negative safe integers, including leading zeroes", () => {
    expect(coordinate("0")).toBe(0);
    expect(coordinate("3")).toBe(3);
    expect(coordinate("003")).toBe(3);
  });

  it("rejects missing, negative, fractional, and non-numeric values", () => {
    expect(coordinate(null)).toBeUndefined();
    expect(coordinate("-1")).toBeUndefined();
    expect(coordinate("1.5")).toBeUndefined();
    expect(coordinate("3x")).toBeUndefined();
    expect(coordinate("")).toBeUndefined();
  });
});

describe("repoPath", () => {
  it("returns the repository-relative path from the session working directory", () => {
    expect(repoPath("/repo", "/repo", "src/frame.ts")).toBe("src/frame.ts");
    expect(repoPath("/repo", "/repo/docs", "../src/frame.ts")).toBe("src/frame.ts");
  });

  it("refuses paths outside the repository and the empty path", () => {
    expect(repoPath("/repo", "/repo", "../outside.ts")).toBeUndefined();
    expect(repoPath("/repo", "/repo", "/elsewhere/frame.ts")).toBeUndefined();
    expect(repoPath("/repo", "/repo", ".")).toBeUndefined();
  });
});

describe("readTurnDiff", () => {
  /** A git fake: the route only needs ref/path reads; the object store is first. */
  const git = (before: string | null, after: string | null) => ({
    run: async (args: readonly string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { exitCode: 0, stdout: "/repo\n", lossy: false };
      }
      if (args[0] === "rev-parse" && args[1] === "--git-path") {
        return { exitCode: 0, stdout: ".git/objects\n", lossy: false };
      }
      if (args[0] === "cat-file" && args[1] === "-e") {
        return { exitCode: 0, stdout: "", lossy: false };
      }
      if (args[0] === "cat-file" && args[1] === "-p") {
        const ref = args[2];
        const text = ref.startsWith("before-tree:") ? before : after;
        return text === null
          ? { exitCode: 128, stdout: "", lossy: false }
          : { exitCode: 0, stdout: text, lossy: false };
      }
      return { exitCode: 128, stdout: "", lossy: false };
    },
  });

  const summary = {
    turn: 3,
    cwd: "/repo",
    files: [{ path: "src/frame.ts", display: "src/frame.ts" }],
    snapshot: { before: "before-tree", after: "after-tree" },
  };

  it("returns both complete sides from the turn's snapshots", async () => {
    const result = await readTurnDiff(
      {} as never,
      git("old\n", "new\n") as never,
      summary as never,
      0,
      new AbortController().signal,
    );
    expect(result).toEqual({ kind: "text", path: "src/frame.ts", before: "old\n", after: "new\n" });
  });

  it("returns null for a side the file did not exist on", async () => {
    const result = await readTurnDiff(
      {} as never,
      git(null, "new\n") as never,
      summary as never,
      0,
      new AbortController().signal,
    );
    expect(result).toEqual({ kind: "text", path: "src/frame.ts", before: null, after: "new\n" });
  });

  it("refuses binary and oversized files before reading git", async () => {
    const binary = { ...summary, files: [{ ...summary.files[0], binary: true }] };
    expect(
      await readTurnDiff(
        {} as never,
        git("", "") as never,
        binary as never,
        0,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "binary" });
    const oversized = { ...summary, files: [{ ...summary.files[0], oversized: true }] };
    expect(
      await readTurnDiff(
        {} as never,
        git("", "") as never,
        oversized as never,
        0,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "oversized" });
  });
});
