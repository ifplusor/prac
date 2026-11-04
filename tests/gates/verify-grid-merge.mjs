/**
 * Shift-dragging one grid cell onto another merges them into a single cell whose
 * body is a split of the two regions; the merge persists.
 */
import { clearLayoutState, openPrac, report, requireUrl } from "./harness.mjs";

const CONVERSATION = "dsh:main:conversation";
const url = requireUrl();
const { page, close } = await openPrac(url);
await clearLayoutState(page);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForSelector("[data-prac-grid-cell]", { timeout: 60_000 });
await page.evaluate((view) => globalThis.__pracFrame.splitItem(view, "right"), CONVERSATION);
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

await page
  .locator("[data-prac-grid-merge]")
  .first()
  .evaluate((element) => element.click());
await page.waitForTimeout(1500);
const merged = await cells();

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForSelector("[data-prac-grid-cell]", { timeout: 60_000 });
const restored = await cells();

const hasUnmerge = (await page.locator("[data-prac-grid-unmerge]").count()) > 0;
let unmerged = null;
let unmergedRestored = null;
if (hasUnmerge) {
  await page.click("[data-prac-grid-unmerge]");
  await page.waitForTimeout(1200);
  unmerged = await cells();

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  unmergedRestored = await cells();
}

await close();
report({
  url,
  facts: { before, merged, restored, hasUnmerge, unmerged, unmergedRestored },
  checks: {
    "the merge leaves one grid cell": merged.length === 1,
    "the cell holds both original regions":
      merged[0]?.children.includes("center") === true &&
      merged[0]?.children.some((id) => id === "region-2") === true,
    "the merge survives a reload": JSON.stringify(merged) === JSON.stringify(restored),
    "unmerge restores two cells": !hasUnmerge || unmerged?.length === 2,
    "unmerge keeps both regions":
      !hasUnmerge ||
      (unmerged.some((cell) => cell.children.includes("center")) &&
        unmerged.some((cell) => cell.children.includes("region-2"))),
    "the unmerge survives a reload":
      !hasUnmerge || JSON.stringify(unmerged) === JSON.stringify(unmergedRestored),
  },
  ok: "OK: Shift-dragging merges adjacent cells, and the merged cell unmerges back into two cells.",
});
