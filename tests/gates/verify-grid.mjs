/**
 * Grid cell editing: a real drag of one cell's handle onto another swaps their
 * placements, and the swap survives a reload. The drag is HTML drag-and-drop;
 * the model half is covered by `grid.spec.ts`.
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

await page.evaluate((view) => globalThis.__pracFrame.splitView(view, "right"), CONVERSATION);
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
const handles = await page.$$eval("[data-prac-grid-handle]", (nodes) =>
  nodes.map((node) => node.getAttribute("data-prac-grid-handle")),
);
const resizeHandles = await page.$$eval("[data-prac-grid-resize]", (nodes) =>
  nodes.map((node) => node.getAttribute("data-prac-grid-resize")),
);
const source = before[0]?.id;
const target = before[1]?.id;
if (source === undefined || target === undefined)
  throw new Error("the split produced fewer than two cells");

await page.evaluate(
  ({ source, target }) => {
    const handle = document.querySelector(`[data-prac-grid-handle="${source}"]`);
    const cell = document.querySelector(`[data-prac-grid-cell="${target}"]`);
    if (!(handle instanceof HTMLElement) || !(cell instanceof HTMLElement)) return;
    const transfer = new DataTransfer();
    handle.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cell.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cell.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  },
  { source, target },
);
await page.waitForTimeout(1500);
const moved = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await cells();

await close();

const box = (list, id) => list.find((cell) => cell.id === id);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const beforeSource = box(before, source);
const afterSource = box(moved, source);
const beforeTarget = box(before, target);
const afterTarget = box(moved, target);

report({
  url,
  facts: { before, handles, resizeHandles, moved, restored },
  checks: {
    "the split produces two editable cells": before.length === 2 && handles.length === 2,
    "each cell has a drag handle": before.every((cell) => handles.includes(cell.id)),
    "each cell has a resize handle": before.every((cell) => resizeHandles.includes(cell.id)),
    "the drag swaps the cells' boxes":
      afterSource?.x === beforeTarget?.x &&
      afterTarget?.x === beforeSource?.x &&
      afterSource?.y === beforeTarget?.y &&
      afterTarget?.y === beforeSource?.y,
    "the move survives a reload": same(moved, restored),
  },
  ok: "OK: dragging a grid cell swaps its placement and the swap persists.",
});
