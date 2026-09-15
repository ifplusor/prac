import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/**
 * `pack` emits both halves, each as its own config because they are different
 * planes rather than a format choice:
 *
 * - the **host half** (`src/index.ts` → `dist/index.mjs`) is intentionally
 *   empty — the mechanism is browser-only — but every bundle row is imported on
 *   both planes, so the entry has to exist.
 * - the **client half** (`src/client.ts` → `dist/client.js`) is the mechanism:
 *   it reads the embed bridge the vendor lib publishes and hands its two part
 *   hosts to prac's frame as the `vscode:*` faces. Its wrapping is DSH's loader
 *   contract, so it comes from `scripts/pack-client.ts` rather than being
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
    clientPack("prac-client-vscode-host", { entry: "src/client/index.ts" }),
    // The client half's published types, emitted from a type-only entry (see
    // `src/client/public.ts`); the `.mjs` is a stub.
    {
      entry: { client: "src/client/public.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-vscode-host" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
