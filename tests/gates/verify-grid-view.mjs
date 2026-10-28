/**
 * Drag a view from the recall catalogue into a grid cell. The row carries the
 * view id; the cell resolves its landing region and places the view there.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const STATE_KEY = "prac-layout/v1";
const CONVERSATION = "dsh:main:conversation";
const VIEW = "dsh:sidebar";
const url = requireUrl();
const { page, close } = await openPrac(url);
await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
await page.evaluate((view) => globalThis.__pracLayout.splitView(view, "right"), CONVERSATION);
await page.waitForTimeout(1200);

await page.keyboard.press("Control+Alt+KeyV");
await page.waitForSelector(`[data-prac-recall-row="${VIEW}"]`, { timeout: 10_000 });
const draggable = await page.$eval(`[data-prac-recall-row="${VIEW}"]`, (row) =>
  row.getAttribute("draggable"),
);

const target = await page.$eval("[data-prac-grid-cell]", (cell) =>
  cell.getAttribute("data-prac-grid-cell"),
);
if (target === null) throw new Error("no grid cell");
await page.evaluate(
  ({ view }) => {
    const row = document.querySelector(`[data-prac-recall-row="${view}"]`);
    if (!(row instanceof HTMLElement)) return;
    const transfer = new DataTransfer();
    globalThis.__pracDragTransfer = transfer;
    row.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  },
  { view: VIEW },
);
await page.waitForTimeout(100);
const dragging = await page.$eval("[data-prac-recall]", (panel) =>
  panel.getAttribute("data-prac-recall-dragging"),
);
await page.evaluate(
  ({ target }) => {
    const cell = document.querySelector(`[data-prac-grid-cell="${target}"]`);
    if (!(cell instanceof HTMLElement)) return;
    const transfer = globalThis.__pracDragTransfer;
    cell.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    cell.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  },
  { target },
);
await page.keyboard.press("Escape");
await page.waitForTimeout(1200);

const placed = await page.evaluate((view) => {
  const record = globalThis.__pracLayout.getState().views[view];
  return record === undefined ? null : { region: record.region, hidden: record.hidden };
}, VIEW);

await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);
const restored = await page.evaluate((view) => {
  const record = globalThis.__pracLayout.getState().views[view];
  return record === undefined ? null : { region: record.region, hidden: record.hidden };
}, VIEW);

await close();
report({
  url,
  facts: { draggable, dragging, target, placed, restored },
  checks: {
    "the catalogue row is draggable": draggable === "true",
    "the panel becomes translucent while dragging": dragging === "true",
    "the drop lands in the target cell": placed !== null && placed.region.startsWith(target),
    "the dropped view is visible": placed?.hidden === false,
    "the placement survives a reload":
      placed !== null && restored !== null && restored.region === placed.region,
  },
  ok: "OK: dragging a catalogue row into a grid cell places the view there and the placement persists.",
});
