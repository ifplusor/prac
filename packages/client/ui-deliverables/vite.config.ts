import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/**
 * The vendored deliverables plugin, two halves.
 *
 * The **host half** is upstream's verbatim: it registers `/api/changes.summary`,
 * `/api/changes.diff`, `/api/changes.open`, the `present` routes and the
 * file-reference system prompt. Only `@deepseek-ai/cordis` is left external;
 * `remoteErrorOf` is a pure structural check and is bundled.
 *
 * The **client half** is upstream's card/delivery/review surface; the one diff
 * lives in `src/client/open-changes.ts` (a changed file opens prac's VS Code
 * diff instead of the right-Sidebar review tab). Its wrapping is DSH's loader
 * contract, so it comes from `scripts/pack-client.ts`.
 */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: { neverBundle: ["@deepseek-ai/cordis"] },
    },
    clientPack("prac-client-ui-deliverables", {
      entry: "src/client/index.ts",
      // The copied card imports values from the shell's primitives and store;
      // both must stay external or the store becomes a second singleton and
      // Shiki gets duplicated into this artifact.
      external: PLATFORM_MODULES,
    }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-ui-deliverables" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
