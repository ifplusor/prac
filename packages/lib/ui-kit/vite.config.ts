import { defineConfig } from "vite-plus";

/** The kit is a pure library: no plugin artifact, no DSH loader, no React. */
export default defineConfig({
  pack: [
    {
      entry: {
        index: "src/index.ts",
        geometry: "src/geometry.ts",
        surface: "src/surface.ts",
        binding: "src/binding.ts",
        allocation: "src/allocation.ts",
        tree: "src/tree.ts",
        grid: "src/grid.ts",
        view: "src/view.ts",
        viewGroup: "src/viewGroup.ts",
        snapshot: "src/snapshot.ts",
      },
      format: ["esm"],
      platform: "neutral",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    },
  ],
});
