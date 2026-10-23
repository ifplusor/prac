/**
 * Shift-dragging one grid cell onto another merges them into a single cell whose
 * body is a split of the two regions; the merge persists.
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
    [...document.querySelectorAll("[data-prac-grid-cell]")].map((cell) => ({
      id: cell.getAttribute("data-prac-grid-cell"),
      children: [...cell.querySelectorAll("[data-prac-region]")].map((region) =>
        region.getAttribute("data-prac-region"),
      ),
    })),
  );
const before = await cells();
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
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        shiftKey: true,
      }),
    );
    cell.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        shiftKey: true,
      }),
    );
  },
  { source, target },
);
await page.waitForTimeout(1500);
const merged = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await cells();

await page.click("[data-prac-grid-unmerge]");
await page.waitForTimeout(1200);
const unmerged = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const unmergedRestored = await cells();

await close();
report({
  url,
  facts: { before, merged, restored, unmerged, unmergedRestored },
  checks: {
    "the merge leaves one grid cell": merged.length === 1,
    "the cell holds both original regions":
      merged[0]?.children.includes("center") === true &&
      merged[0]?.children.some((id) => id === "region-2") === true,
    "the merge survives a reload": JSON.stringify(merged) === JSON.stringify(restored),
    "unmerge restores two cells": unmerged.length === 2,
    "unmerge keeps both regions":
      unmerged.some((cell) => cell.children.includes("center")) &&
      unmerged.some((cell) => cell.children.includes("region-2")),
    "the unmerge survives a reload": JSON.stringify(unmerged) === JSON.stringify(unmergedRestored),
  },
  ok: "OK: Shift-dragging merges adjacent cells, and the merged cell unmerges back into two cells.",
});
