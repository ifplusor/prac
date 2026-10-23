/**
 * Grid cell span resize through the visible handle: dragging the handle down
 * grows the cell into the empty second row, and the span survives a reload.
 * The overlap rule and span arithmetic are unit-tested; this gate only proves
 * the pointer path reaches the model.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const STATE_KEY = "prac-layout/v1";
const CONVERSATION = "dsh:main:conversation";
const url = requireUrl();
const { page, close } = await openPrac(url);
await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);

await page.evaluate((view) => globalThis.__pracLayout.splitView(view, "right"), CONVERSATION);
await page.waitForTimeout(1500);

const cells = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-prac-grid-cell]")].map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        id: cell.getAttribute("data-prac-grid-cell"),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    }),
  );

const before = await cells();
const source = before[0]?.id;
const target = before[1]?.id;
if (source === undefined || target === undefined)
  throw new Error("the split produced fewer than two cells");
const handle = await page.$(`[data-prac-grid-resize="${source}"]`);
const handleBox = await handle?.boundingBox();
const gridBox = await page.evaluate((id) => {
  const cell = document.querySelector(`[data-prac-grid-cell="${id}"]`);
  const grid = cell?.closest("[data-prac-grid]");
  const rect = grid?.getBoundingClientRect();
  return rect === undefined ? null : { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}, source);
if (handleBox === null || handleBox === undefined || gridBox === null) {
  throw new Error("the resize handle or grid box is missing");
}

const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x, start.y + gridBox.h * 0.6, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1500);
const resized = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await cells();

await close();
const box = (list, id) => list.find((cell) => cell.id === id);
const beforeSource = box(before, source);
const afterSource = box(resized, source);
const afterTarget = box(resized, target);

report({
  url,
  facts: { before, resized, restored },
  checks: {
    "the source cell now spans both rows": (afterSource?.h ?? 0) > (afterTarget?.h ?? 0) * 1.5,
    "the other cell gave up the second row": (afterTarget?.h ?? 0) < (beforeSource?.h ?? 0),
    "the span survives a reload": JSON.stringify(resized) === JSON.stringify(restored),
  },
  ok: "OK: dragging a grid cell's resize handle changes its span and the span persists.",
});
