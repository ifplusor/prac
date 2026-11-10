import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite-plus";

import { PLATFORM_MODULES, clientPack } from "../../../scripts/pack-client.ts";

/**
 * `pack` emits both halves, each as its own config because they are different
 * planes rather than a format choice:
 *
 * - the **host half** (`src/index.ts` → `dist/index.mjs`) is intentionally
 *   empty — the mechanism is browser-only — but every bundle row is imported on
 *   both planes, so the entry has to exist.
 * - the **client half** (`src/client.ts` → `dist/client.js`) is is the package that
 *   hosts the VS Code editor part as a prac view. Its wrapping is DSH's loader
 *   contract, so it comes from `scripts/pack-client.ts` rather than being
 *   restated here.
 *
 * `vite.config.ts` is also where the artifact is *verified*: the `check:client`
 * task asserts the emitted bytes (loader closure, answerable requires, no
 * inlined React) instead of a build script asserting them on the side.
 */
// The pdfjs worker is inlined as a string: the dev server and the gate rig have
// no shared static root, and the pack pipeline cannot resolve `?url`/`?raw` for
// this dependency. A Blob URL keeps the worker out of the network entirely.
const require = createRequire(import.meta.url);
const pdfWorkerSource = readFileSync(require.resolve("pdfjs-dist/build/pdf.worker.mjs"), "utf8");

export default defineConfig({
  // pdfjs-dist references the Node `process` global; the client bundle is browser-only.
  define: { "process.env": "{}" },
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "node",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
    clientPack("prac-client-ui-document-preview", {
      entry: "src/client/index.ts",
      define: {
        "process.env": "{}",
        __PRAC_PDF_WORKER__: JSON.stringify(pdfWorkerSource),
      },
    }),
  ],
  run: {
    tasks: {
      "check:client": {
        command:
          "node ../../../scripts/bundle-client.mjs --artifact dist/client.js --id prac-client-ui-document-preview" +
          ` --allow ${PLATFORM_MODULES.join(" --allow ")} --exports apply,name,inject`,
        dependsOn: ["build"],
      },
    },
  },
});
