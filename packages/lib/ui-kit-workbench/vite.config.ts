import { defineConfig } from "vite-plus";

/**
 "* The frame kit is a DSH-free library": no plugin artifact, no DSH loader, no
 * DSH runtime import. React / react-dom stay external because the consuming
 * client bundles answer them from the loader's platform table.
 */
export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: {
        neverBundle: ["react", "react-dom", "prac-ui-kit-content", "prac-ui-kit-layout"],
      },
    },
    // A subpath entry: the page-probe registry is imported by client bundles that
    // must not pull the whole kit (and its React surface) into their chunk.
    {
      entry: { probes: "src/probes.ts" },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
  ],
});
