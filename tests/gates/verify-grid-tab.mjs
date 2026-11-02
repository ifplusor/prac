/**
 * A mounted view's tab can be dragged straight into another grid cell. This is
 * distinct from catalogue drag: the tab carries `text/plain`, the cell places
 * the view and the tab strip retains its own reorder drop path.
 */
import { clearLayoutState, openPrac, report, requireUrl } from "./harness.mjs";

const CONVERSATION = "dsh:main:conversation";
const url = requireUrl();
const { page, close } = await openPrac(url);
await clearLayoutState(page);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
await page.evaluate((view) => globalThis.__pracFrame.splitItem(view, "right"), CONVERSATION);
await page.waitForTimeout(1200);

const target = await page.evaluate(
  () =>
    globalThis.__pracFrame
      .listRegions()
      .map((region) => region.id)
      .find((id) => id !== "center" && id.startsWith("center/")) ??
    globalThis.__pracFrame
      .listRegions()
      .map((region) => region.id)
      .find((id) => id.startsWith("region-")),
);
const cells = await page.$$eval("[data-prac-grid-cell]", (nodes) =>
  nodes.map((node) => node.getAttribute("data-prac-grid-cell")),
);
const cell = cells.find((id) => id !== "center");
if (target === undefined || cell === undefined)
  throw new Error("the split produced no second cell");

await page.evaluate(
  ({ view, target }) => {
    const tab = document.querySelector(`[data-prac-tab="${view}"]`);
    const cell = document.querySelector(`[data-prac-grid-cell="${target}"]`);
    if (!(tab instanceof HTMLElement) || !(cell instanceof HTMLElement)) return;
    const transfer = new DataTransfer();
    tab.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cell.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cell.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  },
  { view: CONVERSATION, target: cell },
);
await page.waitForTimeout(1200);
const placed = await page.evaluate((view) => {
  const record = globalThis.__pracFrame.getState().items[view];
  return record === undefined ? null : { region: record.region, hidden: record.hidden };
}, CONVERSATION);

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await page.evaluate((view) => {
  const record = globalThis.__pracFrame.getState().items[view];
  return record === undefined ? null : { region: record.region, hidden: record.hidden };
}, CONVERSATION);

await close();
report({
  url,
  facts: { target: cell, placed, restored },
  checks: {
    "the tab drops the view into the target cell":
      placed !== null && placed.region.startsWith(cell),
    "the view stays visible": placed?.hidden === false,
    "the tab move survives a reload": JSON.stringify(placed) === JSON.stringify(restored),
  },
  ok: "OK: dragging a mounted tab into another grid cell moves the view there.",
});
