import { defineConfig } from "vite-plus";

import { clientPack } from "../../../scripts/pack-client.ts";

/**
 * `ui-frame` is a DSH plugin row, not a library:
 * - `.` is the host half (`apply` only);
 * - `./client` is the loader artifact for the row, with its own `types`
 *   condition generated from `src/client/contract.ts` (the `SlotMap` /
 *   `Context` merges and the face types).
 *
 * The layout model / renderer / chrome live in `prac-ui-kit-frame`; the DSH
 * store, slot catalogue and contract merges live here.
 *
 * Every declaration artifact keeps cordis / ui-slots / the frame kit external:
 * inlining their types gives the consumer a second module record, and the
 * `declare module './context.ts'` merges stop landing on the real cordis.
 */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: {
        neverBundle: [
          "@deepseek-ai/cordis",
          "@deepseek-ai/dsh-client-ui-slots",
          "prac-ui-kit-frame",
        ],
      },
    },
    {
      entry: { "client-types": "src/client/contract.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: {
        neverBundle: [
          "@deepseek-ai/cordis",
          "@deepseek-ai/dsh-client-ui-slots",
          "prac-ui-kit-frame",
        ],
      },
    },
    clientPack("prac-client-ui-frame", {
      entry: "src/client/plugin.ts",
      external: ["react-dom", "@deepseek-ai/dsh-client-store"],
    }),
  ],
});
