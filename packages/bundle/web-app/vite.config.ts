import { defineConfig } from "vite-plus";

import { CLIENT_EXTERNALS, clientPack } from "../../../scripts/pack-client.ts";

/**
 * `pack` emits both halves of this package, each as its own config because they
 * are different planes rather than a format choice:
 *
 * - the **host half** (`src/index.ts` → `dist/index.mjs`) is the Node entry the
 *   DSH loader imports; it does not carry the arrangement, it *is* the entry
 *   that lets the bundle be composed at all.
 * - the **client half** (`src/client.ts` → `dist/client.js`) holds the
 *   arrangement — the default placements, the attention strip, the recall
 *   surface. Its wrapping is DSH's loader contract, so it comes from
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
    clientPack("prac-web-app", { entry: "src/client/index.ts" }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-web-app" +
          ` --allow ${CLIENT_EXTERNALS.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
