import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
import { writeFixtures } from "../../../../vendor/vscode/scripts/gate-fixtures.mjs";
const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url = process.env.URL;
const [FILE] = writeFixtures("drag-mouse", url, [{ name: "m.txt", body: "one\ntwo\n" }]);
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
await page.waitForTimeout(3500);

const snap = () => page.evaluate(() => {
  const layout = globalThis.__pracLayout.getState();
  const walk = (n) => {
    if (n.type === "grid") return { children: n.children.map(c => c.id), columns: n.columns, active: n.active, placements: n.placements };
    for (const c of n.children ?? []) { const g = walk(c); if (g) return g; }
    return null;
  };
  const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
  return {
    stage: walk(layout.tree),
    cells: [...document.querySelectorAll("[data-prac-grid-cell]")].map(e => ({ id: e.getAttribute("data-prac-grid-cell"), ...box(`[data-prac-grid-cell="${e.getAttribute("data-prac-grid-cell")}"]`) })),
    tabs: [...document.querySelectorAll("[data-prac-tab]")].map(e => `${e.getAttribute("data-prac-tab")}@${e.closest("[data-prac-region]")?.getAttribute("data-prac-region")}`),
    center: box('[data-prac-region="center"]'),
    hostFiles: [...document.querySelectorAll("[data-vscode-embed-file]")].length,
    lines: globalThis.__deep ? globalThis.__deep.all(".view-line").map((e) => e.textContent).filter(Boolean).slice(0, 5) : null,
    placements: globalThis.__vscodeEmbed.face.listPlacements().map(p => `${p.placement}@${p.region}`),
  };
});

await page.evaluate(() => globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.splitEditorRight"));
await page.waitForTimeout(3000);
const split = await snap();
console.log("SPLIT", JSON.stringify(split, null, 2));
const view = split.tabs.find(t => t.includes("@region-2"))?.split("@")[0];
if (!view) throw new Error("no right tab");

// Actual mouse drag (HTML5) from the right tab onto the center cell.
await page.locator(`[data-prac-tab="${view.replaceAll('"', '\\"')}"]`).dragTo(page.locator('[data-prac-grid-cell="center"]'));
await page.waitForTimeout(3500);
const dragged = await snap();
console.log("DRAGGED", JSON.stringify(dragged, null, 2));
await page.screenshot({ path: new URL("./drag-right-to-left.png", import.meta.url).pathname });

const problems = [];
if (dragged.stage.children.length !== 1 || dragged.stage.columns !== 1) {
  problems.push(`stage did not merge: ${JSON.stringify(dragged.stage)}`);
}
if (dragged.center === null || dragged.center.w < 1000) {
  problems.push(`center did not fill the stage: ${JSON.stringify(dragged.center)}`);
}
if (dragged.tabs.filter((tab) => tab.includes("m.txt")).length !== 1) {
  problems.push(`file tab count: ${JSON.stringify(dragged.tabs)}`);
}
if (dragged.lines === null || dragged.lines.some((line) => line.includes("vscode:file:"))) {
  problems.push(`drag text reached the editor: ${JSON.stringify(dragged.lines)}`);
}
if (dragged.placements.some((placement) => !placement.endsWith("@center"))) {
  problems.push(`orphan placement: ${JSON.stringify(dragged.placements)}`);
}
console.log("ERRORS", errors.filter(e => e.includes("vscode-embed:")).slice(0, 6));
await browser.close();
if (problems.length > 0) {
  console.error("FAIL\n" + problems.join("\n"));
  process.exit(1);
}
console.log("PASS");
