import { defineConfig } from "vite-plus";

/** Content composition is a DSH-free library; React stays external. */
export default defineConfig({
  pack: [
    {
      entry: {
        index: "src/index.ts",
        react: "src/react.ts",
        content: "src/content.ts",
        contentHostMount: "src/contentHostMount.ts",
        placement: "src/placement.ts",
        model: "src/model.ts",
        store: "src/store.ts",
        switching: "src/switching.ts",
        snapshot: "src/snapshot.ts",
        "workspace-scope": "src/workspace-scope.ts",
        isolation: "src/isolation.ts",
        chrome: "src/chrome.ts",
        renderModel: "src/renderModel.ts",
        renderer: "src/layoutRenderer.ts",
        tabs: "src/layoutTabs.ts",
        stack: "src/layoutStack.ts",
        sash: "src/layoutSash.ts",
        containerBar: "src/layoutContainerBar.ts",
        grid: "src/layoutGrid.ts",
        chromeIntents: "src/chromeIntents.ts",
        containerChrome: "src/containerChrome.ts",
        resize: "src/resizeController.ts",
        sashDrag: "src/layoutSashDrag.ts",
        stackDrag: "src/layoutStackDrag.ts",
        layoutIsolation: "src/layoutIsolation.ts",
      },
      format: ["esm"],
      platform: "browser",
      outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
      deps: { neverBundle: ["react", "react-dom"] },
    },
  ],
});
