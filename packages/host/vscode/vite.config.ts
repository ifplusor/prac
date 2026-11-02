import { defineConfig } from "vite-plus";

/**
 "* Host-only package": one Node entry the DSH loader imports.
 *
 * There is no client half. The parts that render in the page are declared by the
 * view-declaring packages (`prac-client-ui-vscode-editor` / `-explorer`) and booted by
 * `prac-client-vscode-host`; what lives here is only the same-origin boundary —
 * the route that serves the built VS Code bundle and the proxy to the code server.
 *
 * The upstream pin, patch set and build that produce what this route serves are
 * `prac-vscode`'s (the vendor package). Reaching the build output from here uses
 * the same relative depth, so no path knowledge is duplicated.
 */
export default defineConfig({
  pack: {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "node",
    outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
    deps: {
      neverBundle: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-lsp"],
    },
  },
});
