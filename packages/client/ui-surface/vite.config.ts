import { defineConfig } from "vite-plus";

/**
 * `ui-surface` is a library, not a DSH client bundle: the frame inlines it and
 * the browser never reaches it through the loader.
 */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    {
      entry: { client: "src/client/index.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".js", dts: ".d.mts" }),
    },
  ],
});
