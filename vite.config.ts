import { defineConfig } from "vite-plus";

export default defineConfig({
  // `.agents/notes/` and `.agents/worklog/` are hand-written prose — the decision
  // memory and the process memory — and must not be reflowed by the formatter (see
  // AGENTS.md). Everything else in the repository — code, scripts, configs, docs —
  // is formatted and checked.
  fmt: { ignorePatterns: [".agents/notes/**", ".agents/worklog/**"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
    },
    overrides: [
      {
        files: ["vendor/**"],
        rules: { "unicorn/filename-case": "off" },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
