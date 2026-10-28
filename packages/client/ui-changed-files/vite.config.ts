import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/** `ui-changed-files` is a DSH plugin; `./lib` is its component library. */
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
    clientPack("prac-client-ui-changed-files", { entry: "src/client/plugin.ts" }),
  ],
});
