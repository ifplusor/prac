import { describe, expect, it } from "vite-plus/test";

import { DSH_CONVERSATION_VIEW, DSH_MAIN_PREFIX, dshMainKey, dshMainView } from "./dsh.js";

describe("ui-dsh slot helpers", () => {
  it("builds a keyed main view id", () => {
    expect(dshMainView("plugins")).toBe(`${DSH_MAIN_PREFIX}plugins`);
  });

  it("keeps the conversation id stable", () => {
    expect(DSH_CONVERSATION_VIEW).toBe("dsh:main:conversation");
    expect(dshMainKey(DSH_CONVERSATION_VIEW)).toBe("conversation");
  });

  it("returns undefined for a non-main slot", () => {
    expect(dshMainKey("dsh:sidebar")).toBeUndefined();
  });
});
