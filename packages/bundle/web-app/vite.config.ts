import { defineConfig } from "vite-plus";

/** `web-app` is a bundle patch; it has no client plugin body. */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
  ],
});
