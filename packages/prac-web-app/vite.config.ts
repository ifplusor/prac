import { defineConfig } from "vite-plus";

export default defineConfig({
  // C1 emits a JS-only library: DSH resolves the plugin package by its
  // exports/main at runtime, and the .d.ts story is deferred (see src/dsh.d.ts
  // for the recorded type-friction observation). The DSH platform packages are
  // kept external via the `--deps.never-bundle` flags in the build script.
  pack: {},
});
