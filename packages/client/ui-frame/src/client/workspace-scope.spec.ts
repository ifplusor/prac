import { describe, expect, it } from "vite-plus/test";
import { NO_WORKSPACE_SCOPE, workspaceScope } from "./workspace-scope.js";

describe("workspaceScope", () => {
  it("is stable for the same workspace", () => {
    expect(workspaceScope("?workspace=/Volumes/Dev/prac/prac-dev")).toBe(
      workspaceScope("?workspace=/Volumes/Dev/prac/prac-dev"),
    );
  });

  it("separates different workspaces", () => {
    expect(workspaceScope("?workspace=/a")).not.toBe(workspaceScope("?workspace=/b"));
  });

  it("treats a trailing slash as the same workspace", () => {
    expect(workspaceScope("?workspace=/a/")).toBe(workspaceScope("?workspace=/a"));
  });

  it("has a scope before a folder is selected", () => {
    expect(workspaceScope("")).toBe(NO_WORKSPACE_SCOPE);
    expect(workspaceScope("?workspace=")).toBe(NO_WORKSPACE_SCOPE);
  });

  it("decodes the query value before hashing", () => {
    expect(workspaceScope("?workspace=%2Fa%20b")).toBe(workspaceScope("?workspace=/a b"));
  });
});
