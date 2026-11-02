import { defineConfig } from "vite-plus";

/** Content composition is a DSH-free library; React stays external. */
export default defineConfig({
  pack: [
    {
      entry: {
        index: "src/index.ts",
        react: "src/react.ts",
        content: "src/content.ts",
        "content-host-mount": "src/content-host-mount.ts",
        placement: "src/placement.ts",
        model: "src/model.ts",
        store: "src/store.ts",
        switching: "src/switching.ts",
        snapshot: "src/snapshot.ts",
        "workspace-scope": "src/workspace-scope.ts",
        isolation: "src/isolation.ts",
        chrome: "src/chrome.ts",
        "render-model": "src/render-model.ts",
        renderer: "src/layout-renderer.ts",
        tabs: "src/layout-tabs.ts",
        stack: "src/layout-stack.ts",
        sash: "src/layout-sash.ts",
        "container-bar": "src/layout-container-bar.ts",
        grid: "src/layout-grid.ts",
        "chrome-intents": "src/chrome-intents.ts",
        "container-chrome": "src/container-chrome.ts",
        resize: "src/resize-controller.ts",
        "sash-drag": "src/layout-sash-drag.ts",
        "stack-drag": "src/layout-stack-drag.ts",
        "layout-isolation": "src/layout-isolation.ts",
      },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: { neverBundle: ["react", "react-dom"] },
    },
  ],
});
