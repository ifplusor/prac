import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/** `ui-window` is a DSH plugin; `./lib` exposes its types / model. */
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
      deps: { neverBundle: ["react"] },
    },
    clientPack("prac-client-ui-window", { entry: "src/client/plugin.ts" }),
  ],
});
