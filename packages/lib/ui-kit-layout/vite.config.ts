import { defineConfig } from "vite-plus";

/** The kit is a pure layout library: no plugin artifact, no DSH loader, no React. */
export default defineConfig({
  pack: [
    {
      entry: {
        index: "src/index.ts",
        geometry: "src/geometry.ts",
        allocation: "src/allocation.ts",
        tree: "src/tree.ts",
        grid: "src/grid.ts",
      },
      format: ["esm"],
      platform: "neutral",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
  ],
});
