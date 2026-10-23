/**
 * Free grid track resize: dragging the boundary between columns changes their
 * pixel widths (not a cell span) and the weights persist.
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
        w: Math.round(box.width),
      };
    }),
  );
const before = await cells();
const handle = await page.$('[data-prac-grid-track="column:1"]');
const box = await handle?.boundingBox();
if (before.length !== 2 || box === null || box === undefined) {
  throw new Error("the split produced no resizable column boundary");
}
const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x - 180, start.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1200);
const resized = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await cells();

await close();
const narrowed = resized[0];
const widened = resized[1];
report({
  url,
  facts: { before, resized, restored },
  checks: {
    "the boundary exists": before.length === 2,
    "the first column narrows": (narrowed?.w ?? 0) < (before[0]?.w ?? 0) - 80,
    "the second column widens": (widened?.w ?? 0) > (before[1]?.w ?? 0) + 80,
    "the weights survive a reload": JSON.stringify(resized) === JSON.stringify(restored),
  },
  ok: "OK: dragging a grid track boundary resizes the columns in pixels and persists.",
});
