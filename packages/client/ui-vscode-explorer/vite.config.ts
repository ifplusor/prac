import { defineConfig } from "vite-plus";

import { CLIENT_EXTERNALS, clientPack } from "../../../scripts/pack-client.ts";

/**
 * `pack` emits both halves, each as its own config because they are different
 * planes rather than a format choice:
 *
 * - the **host half** (`src/index.ts` → `dist/index.mjs`) is intentionally
 *   empty — the mechanism is browser-only — but every bundle row is imported on
 *   both planes, so the entry has to exist.
 * - the **client half** (`src/client.ts` → `dist/client.js`) is the mechanism:
 *   the frame, the region tree, the sashes, the view catalogue and both
 *   services. Its wrapping is DSH's loader contract, so it comes from
 *   `scripts/pack-client.ts` rather than being restated here.
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
    clientPack("prac-client-ui-vscode-explorer", { entry: "src/client/index.ts" }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-ui-vscode-explorer" +
          ` --allow ${CLIENT_EXTERNALS.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
