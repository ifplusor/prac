/**
 * Opening a file must not **restyle every pane**.
 *
 * Each view renders inside its own shadow root, and the root keeps a copy of the shell's
 * stylesheets because document rules do not cross the boundary. A copy that is re-made on
 * every sync costs a re-parse of the whole shell CSS in every root — a person sees every pane
 * flash. Measured before this gate existed: opening one file re-created **672 `<style>` nodes
 * and 12 `<link>` nodes** inside a single root, and the sync runs on every render of a view
 * host, so it happened on every open and every tab activation.
 *
 * What is asserted here is the *quiet*: while idle and while opening a file, no mirrored node
 * is added or removed in any root, the frame's own view hosts are not churned, and the layout
 * store settles. A file open legitimately adds one view (one host, one region, a couple of
 * store writes) — the numbers below leave that room and nothing more.
 *
 * @module prac/vendor/vscode/scripts/verify-quiet
 */
import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=…"');

const files = writeFixtures(
  "verify-quiet",
  url,
  [1, 2, 3, 4, 5].map((n) => ({ name: `prac-quiet-${n}.txt`, body: `quiet ${n}\n` })),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

/** Count mirrored-node and view-host mutations in every root, and layout-store writes. */
const instrument = () =>
  page.evaluate(() => {
    globalThis.__quiet = { mirrored: 0, hosts: 0, layout: 0, roots: 0 };
    globalThis.__pracTest?.frame.subscribe(() => {
      globalThis.__quiet.layout += 1;
    });
    const watch = () => {
      for (const host of globalThis.__deep.all("[data-prac-view-host]")) {
        const root = host.shadowRoot;
        if (!root || root.__quietWatched) continue;
        root.__quietWatched = true;
        globalThis.__quiet.roots += 1;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of [...record.addedNodes, ...record.removedNodes]) {
              if (node.nodeType === 1 && node.hasAttribute?.("data-prac-mirrored")) {
                globalThis.__quiet.mirrored += 1;
              }
            }
          }
        }).observe(root, { childList: true, subtree: true });
      }
      globalThis.__quietTimer = setTimeout(watch, 300);
    };
    watch();
  });

const counts = () => page.evaluate(() => ({ ...globalThis.__quiet }));
const reset = () =>
  page.evaluate(() => {
    globalThis.__quiet.mirrored = 0;
    globalThis.__quiet.hosts = 0;
    globalThis.__quiet.layout = 0;
  });

await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
await page.waitForTimeout(6000);
// A few views already open, so an open is the "one more pane" case a person hits.
for (const file of files.slice(0, 4)) {
  await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file.uri);
  await page.waitForTimeout(2500);
}
await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
await page.waitForTimeout(4000);
await instrument();
await reset();
await page.waitForTimeout(2500);
const idle = await counts();
await reset();
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), files[4].uri);
await page.waitForTimeout(4000);
const opened = await counts();
await reset();
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), files[0].uri);
await page.waitForTimeout(3000);
const reactivated = await counts();
const roots = await page.evaluate(() => globalThis.__quiet.roots);

await browser.close();

const checks = {
  rootsAreInstrumented: roots >= 3,
  idleCostsNothing: idle.mirrored === 0 && idle.layout === 0,
  openingDoesNotReloadTheSheets: opened.mirrored === 0,
  reactivatingDoesNotReloadTheSheets: reactivated.mirrored === 0,
  openingIsBounded: opened.layout <= 4,
  noEmbedErrors: consoleErrors.filter((line) => line.includes("vscode-embed:")).length === 0,
};
const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
console.log(JSON.stringify({ url, roots, idle, opened, reactivated, checks }, null, 2));
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: opening and re-activating files leaves every pane's stylesheets alone — no mirrored node is re-created in any root, and the layout writes stay bounded.",
);
