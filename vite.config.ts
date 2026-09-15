import { defineConfig } from "vite-plus";

export default defineConfig({
  // `.agents/notes/` is James's prose: the decision memory is written by hand and
  // must not be reflowed by the formatter (see AGENTS.md). Everything else in the
  // repository — code, scripts, configs, docs — is formatted and checked.
  fmt: { ignorePatterns: [".agents/notes/**"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
