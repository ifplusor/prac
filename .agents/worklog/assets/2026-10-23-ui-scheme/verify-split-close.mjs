import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
import { writeFixtures } from "../../../../vendor/vscode/scripts/gate-fixtures.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url = process.env.URL;
if (!url) throw new Error("URL is required");

const [FILE] = writeFixtures("split-close2", url, [{ name: "split2.txt", body: "one\ntwo\nthree\n" }]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
if (await page.$("[data-prac-firstrun]")) {
  await page.locator("[data-prac-firstrun] button", { hasText: "prac-dev" }).first().click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(2500);
}
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), FILE.uri);
await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
await page.waitForTimeout(4000);

const state = () => page.evaluate(() => {
  const layout = globalThis.__pracLayout.getState();
  const walk = (node) => {
    if (node.type === "grid") return { id: node.id, children: node.children.map(c => c.id), columns: node.columns, placements: node.placements, active: node.active };
    for (const child of node.children ?? []) { const g = walk(child); if (g) return g; }
    return null;
  };
  return {
    stage: walk(layout.tree),
    cells: [...document.querySelectorAll("[data-prac-grid-cell]")].map(e => e.getAttribute("data-prac-grid-cell")),
    tabs: [...document.querySelectorAll("[data-prac-tab]")].map(e => {
      const region = e.closest("[data-prac-region]");
      return `${e.getAttribute("data-prac-tab")}@${region?.getAttribute("data-prac-region")}`;
    }),
    views: layout.views,
  };
});

const before = await state();
console.log("BEFORE", JSON.stringify({ stage: before.stage, cells: before.cells, tabs: before.tabs }, null, 2));

await page.evaluate(() => globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.splitEditorRight"));
await page.waitForTimeout(3500);
const afterSplit = await state();
console.log("AFTER SPLIT", JSON.stringify({ stage: afterSplit.stage, cells: afterSplit.cells, tabs: afterSplit.tabs }, null, 2));
await page.screenshot({ path: new URL("./split-right-open.png", import.meta.url).pathname });

// Close through the tab's × (the UI path the report describes).
const clicked = await page.evaluate(() => {
  const cell = document.querySelector('[data-prac-grid-cell="region-2"]');
  const close = cell?.querySelector("[data-prac-tab-close]");
  if (!(close instanceof HTMLElement)) return false;
  close.click();
  return true;
});
await page.waitForTimeout(3500);
const afterClose = await state();
console.log("TAB CLOSE clicked=" + clicked, JSON.stringify({ stage: afterClose.stage, cells: afterClose.cells, tabs: afterClose.tabs }, null, 2));
await page.screenshot({ path: new URL("./split-right-closed.png", import.meta.url).pathname });

// And a second round closed by the workbench command, for contrast.
await page.evaluate(() => globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.splitEditorRight"));
await page.waitForTimeout(3000);
await page.evaluate(() => globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.closeActiveEditor"));
await page.waitForTimeout(3000);
const afterCommand = await state();
console.log("CMD CLOSE", JSON.stringify({ stage: afterCommand.stage, cells: afterCommand.cells }, null, 2));

console.log("ERRORS", errors.filter(e => e.includes("vscode-embed:")).slice(0, 5));
await browser.close();
