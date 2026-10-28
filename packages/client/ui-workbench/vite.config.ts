import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/** `ui-workbench` is a DSH plugin: library code is internal, `./client` is the loader artifact. */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    clientPack("prac-client-ui-workbench", {
      entry: "src/client/plugin.ts",
      external: ["react-dom"],
    }),
  ],
});
