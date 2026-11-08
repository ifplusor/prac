/**
 * Inject the emitted stylesheet into the client artifact.
 *
 * DSH serves `dist/client.js` verbatim and never loads a sibling `.css`; the
 * upstream package inlines its CSS modules at build time through tsdown's
 * lightningcss plugin, which prac's `clientPack` does not reproduce. So the
 * stylesheet Vite emits is inserted into the loader factory as a tagged
 * `<style>` — the same runtime shape upstream produces (`data-plugin-css`).
 *
 * Run after `vp pack`. The footer marker is `clientPack`'s, not this script's;
 * if it moves, fail loudly rather than ship an unstyled card.
 *
 * @module scripts/inject-css
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const clientFile = join(dist, "client.js");

if (!existsSync(clientFile)) {
  console.error("inject-css: dist/client.js is missing; run `vp pack` first");
  process.exit(1);
}

const cssFiles = readdirSync(dist).filter((name) => name.endsWith(".css"));
if (cssFiles.length === 0) {
  // A build without CSS is valid: nothing to inject.
  process.exit(0);
}

const css = cssFiles.map((name) => readFileSync(join(dist, name), "utf8")).join("\n");
const tagId = "prac-client-ui-deliverables/style.css";
const injection =
  "\n;(() => { const css = " +
  JSON.stringify(css) +
  "; const id = " +
  JSON.stringify(tagId) +
  "; if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(id) + ']') === null) { const tag = document.createElement('style'); tag.dataset.plugin = 'prac-client-ui-deliverables'; tag.dataset.pluginCss = id; tag.textContent = css; document.head.appendChild(tag); } })();\n";

const marker = "return module.exports; } });";
const source = readFileSync(clientFile, "utf8");
if (!source.includes(marker)) {
  console.error("inject-css: the clientPack footer marker is missing; refusing to ship unstyled");
  process.exit(1);
}
writeFileSync(clientFile, source.replace(marker, `${injection}${marker}`));
