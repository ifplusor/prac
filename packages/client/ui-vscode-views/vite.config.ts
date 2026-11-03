import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/**
 * `pack` emits both halves, each as its own config because they are different
 * planes rather than a format choice:
 *
 * - the **host half** (`src/index.ts` → `dist/index.mjs`) is intentionally
 *   empty — the client half is browser-only — but every bundle row is imported on both
 *   planes, so the entry has to exist.
 * - the **client half** (`src/client/index.ts` → `dist/client.js`) declares one
 *   `prac.widget` per entry of the app's view catalogue. Its wrapping is DSH's
 *   loader contract, so it comes from `scripts/pack-client.ts` rather than being
 *   restated here.
 *
 * `vite.config.ts` is also where the artifact is *verified*: the `check:client`
 * task asserts the emitted bytes (loader closure, answerable requires, no
 * inlined React) instead of a build script asserting them on the side.
 */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    clientPack("prac-client-ui-vscode-views", { entry: "src/client/index.ts" }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-ui-vscode-views" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
