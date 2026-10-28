import { defineConfig } from "vite-plus";

/**
 * `ui-frame` is a library, not a DSH client bundle: the frame package inlines
 * its geometry and the browser never reaches it through the loader.
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
      // The package is inlined by ui-layout's client bundle; platform words must
      // stay external here too, or the store/React would be duplicated.
      deps: {
        neverBundle: [
          "react",
          "react-dom",
          "@deepseek-ai/cordis",
          "@deepseek-ai/dsh-client-store",
          "@deepseek-ai/dsh-client-ui-slots",
          "@deepseek-ai/dsh-client-ui-primitives",
          "@deepseek-ai/dsh-client-ui-dockkit",
        ],
      },
    },
  ],
});
