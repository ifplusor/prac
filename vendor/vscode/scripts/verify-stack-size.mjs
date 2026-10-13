/**
 * A stack entry's height is the person's to set, and it is remembered.
 *
 * The entries of a stack share the height equally by default, and the only control used to be
 * folding the others — which is not "make this one taller", it is "hide the rest". Upstream's
 * viewlets are resized by dragging the boundary between them, so the frame now puts a
 * draggable boundary between adjacent entries (`data-prac-stack-boundary`): the entry **above**
 * the boundary takes the new height, the rest share what is left, the size lands in the view
 * record and therefore in the persisted layout.
 *
 * @module prac/vendor/vscode/scripts/verify-stack-size
 */
import { createRequire } from "node:module";
import { installDeepDom } from "./deep-dom.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=…"');

const FILE_VIEW = "vscode:view:workbench.explorer.fileView";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));
await installDeepDom(page);

/** The container's entries: the file view's height, and the size the layout carries for it. */
const measure = () =>
  page.evaluate((view) => {
    const height = (id) => {
      const node = globalThis.__deep.one(`[data-prac-stack-entry="${id}"]`);
      return node ? Math.round(node.getBoundingClientRect().height) : null;
    };
    const raw = JSON.parse(localStorage.getItem("prac-layout/v1") ?? "null");
    return {
      fileView: height(view),
      neighbour: height("vscode:view:outline"),
      boundary: Boolean(globalThis.__deep.one(`[data-prac-stack-boundary="${view}"]`)),
      persisted: raw?.views?.[view]?.size ?? null,
    };
  }, FILE_VIEW);

const boot = async () => {
  await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
  await page.waitForTimeout(8000);
};

await page.goto(url, { waitUntil: "load" });
await boot();
// The stack entries only exist once the container is the shown child.
const showContainer = async () => {
  const spot = await page.evaluate(() => {
    const node = globalThis.__deep.one('[data-prac-container*="workbench.view.explorer"]');
    const box = node?.getBoundingClientRect();
    return box
      ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
      : null;
  });
  if (spot === null) return;
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(1500);
};
await showContainer();
await page.reload({ waitUntil: "load" });
await boot();
await showContainer();

const before = await measure();
const boundary = await page.evaluate((view) => {
  const node = globalThis.__deep.one(`[data-prac-stack-boundary="${view}"]`);
  const box = node?.getBoundingClientRect();
  return box
    ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    : null;
}, FILE_VIEW);

const DRAG = 60;
if (boundary !== null) {
  await page.mouse.move(boundary.x, boundary.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  for (const step of [10, 25, 40, DRAG]) {
    await page.mouse.move(boundary.x, boundary.y + step);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
}
const dragged = await measure();

await page.reload({ waitUntil: "load" });
await boot();
await showContainer();
const restored = await measure();
await browser.close();

const grew = (a, b) => (a?.fileView ?? 0) - (b?.fileView ?? 0);
const checks = {
  everyEntryHasABoundary: before.boundary === true,
  draggingGrowsTheEntry: grew(dragged, before) >= DRAG - 8,
  theNeighbourGivesUpRoom: (before.neighbour ?? 0) - (dragged.neighbour ?? 0) > 0,
  theSizeIsWritten:
    dragged.persisted !== null && Math.abs(dragged.persisted - dragged.fileView) <= 2,
  itSurvivesAReload: Math.abs((restored.fileView ?? 0) - (dragged.fileView ?? 0)) <= 2,
  noEmbedErrors: consoleErrors.filter((line) => line.includes("vscode-embed:")).length === 0,
};
const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
console.log(JSON.stringify({ url, before, dragged, restored, checks }, null, 2));
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: a stack entry's height is draggable, the neighbour gives up the room, and the size survives a reload.",
);
