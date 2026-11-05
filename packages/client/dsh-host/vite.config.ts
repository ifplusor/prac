import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/** `ui-dsh` is a DSH plugin: the vocabulary is internal, `ctx.pracDsh` is the shared surface. */
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
      deps: { neverBundle: ["@deepseek-ai/cordis"] },
    },
    clientPack("prac-client-dsh-host", { entry: "src/client/index.ts" }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-dsh-host" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
