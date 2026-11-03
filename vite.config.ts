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
    tasks: {
      // `vp run verify` is the whole baseline: static gates, then live acceptance.
      verify: {
        command: "node tests/ui.mjs",
        dependsOn: ["verify:static"],
      },
      "verify:static": {
        command:
          "node tests/static/entries.ts && node tests/static/packages.ts && node scripts/dsh-types.mjs --compare",
      },
      // `vp run verify:ui -- file,stack` narrows the live roster.
      "verify:ui": { command: "node tests/ui.mjs" },
      // `vp run verify:gate -- file` needs URL=<a running page>.
      "verify:gate": { command: "node tests/gate.mjs" },
    },
  },
});
