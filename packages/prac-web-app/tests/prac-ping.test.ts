import { describe, expect, it, vi } from "vite-plus/test";
import { apply, inject, name, type PingResult } from "../src/index.ts";

// Mock the DSH seam so this test exercises the bundle's own contribution and
// does not require the real platform packages to be installed in this repo.
// This is the runtime-independent unit gate; the real platform is covered by
// the profile-level headless check.
vi.mock("@deepseek-ai/dsh-tools", () => ({
  defineTool: (options: unknown) => options,
}));

/** A fake Cordis context that records tool registrations. */
function makeCtx() {
  return { tools: { register: vi.fn() } };
}

describe("prac-web-app", () => {
  it("exposes the cordis plugin name and injects the tools service", () => {
    expect(name).toBe("prac-web-app");
    expect(inject).toEqual(["tools"]);
  });

  it("registers a prac_ping tool on the tools registry", () => {
    const ctx = makeCtx();
    apply(ctx as unknown as Parameters<typeof apply>[0]);
    expect(ctx.tools.register).toHaveBeenCalledTimes(1);
    const tool = ctx.tools.register.mock.calls[0]?.[0];
    expect(tool).toMatchObject({ name: "prac_ping" });
  });

  it("prac_ping returns ok with identity and a current time", async () => {
    const ctx = makeCtx();
    apply(ctx as unknown as Parameters<typeof apply>[0]);
    const tool = ctx.tools.register.mock.calls[0]?.[0];
    const result = (await tool.execute()) as PingResult;
    expect(result.ok).toBe(true);
    expect(result.name).toBe("prac");
    expect(typeof result.version).toBe("string");
    expect(typeof result.time).toBe("number");
  });
});
