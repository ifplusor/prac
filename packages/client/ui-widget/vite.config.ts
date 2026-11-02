import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/** `ui-widget` is a DSH plugin: the board model is internal, `ctx.pracWidgets` is the shared surface. */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    {
      entry: { "client-types": "src/client/contract.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: {
        neverBundle: [
          ...PLATFORM_MODULES,
          "prac-client-ui-frame",
          "prac-ui-kit-workbench",
          "prac-ui-kit-content",
          "prac-ui-kit-layout",
        ],
      },
    },
    clientPack("prac-client-ui-widget", {
      entry: "src/client/index.ts",
      external: ["react-dom", "@deepseek-ai/dsh-client-store"],
    }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-ui-widget" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
