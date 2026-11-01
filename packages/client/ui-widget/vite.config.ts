import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/** `ui-widget` is a DSH plugin; `./lib` exposes its types / model. */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    {
      entry: { lib: "src/client/index.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".js", dts: ".d.mts" }),
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
    clientPack("prac-client-ui-widget", {
      entry: "src/client/plugin.ts",
      external: ["react-dom", "@deepseek-ai/dsh-client-store"],
    }),
  ],
});
