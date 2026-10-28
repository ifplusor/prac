import { defineConfig } from "vite-plus";

/** `ui-dsh` is a library; the workbench composes it. */
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
