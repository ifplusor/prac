import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/** `ui-dsh` is a DSH plugin; `./lib` exposes the pure slot helpers. */
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
    },
    clientPack("prac-client-ui-dsh", { entry: "src/client/plugin.ts" }),
  ],
});
