/**
 * Verification of the recall surface in the rail UI.
 *
 * The old vendor gate assumed the container-bar layout and right region. This
 * gate drives the same surface through its public UI: keyboard toggle, catalogue
 * rows, hide/show, and focus.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:views
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);
await page.waitForTimeout(2000);

const open = async () => {
  await page.keyboard.press("Meta+Alt+v");
  await page.waitForSelector("[data-prac-recall]", { timeout: 10_000 });
};
const closeOverlay = async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-prac-recall]", { state: "detached", timeout: 10_000 });
};

await open();
const catalogue = await page.evaluate(() => ({
  rows: [...document.querySelectorAll("[data-prac-recall-row]")].map((row) =>
    row.getAttribute("data-prac-recall-row"),
  ),
  views: globalThis.__pracFrame
    .listItems()
    .filter((view) => view.kind !== "widget")
    .map((view) => view.id),
  selected:
    document
      .querySelector("[data-prac-recall-row][data-prac-recall-selected]")
      ?.getAttribute("data-prac-recall-row") ?? null,
}));

// Hide one row, then show it again through the same surface.
// A frame **window** view: widgets are board-owned and no longer start from the frame's
// view table, so the recall surface must not offer them (a second home would double-render).
const target = "dsh:main:conversation";
const before = await page.evaluate(
  (id) => globalThis.__pracFrame.listItems().find((view) => view.id === id),
  target,
);
await page.click(`[data-prac-recall-toggle="${target}"]`);
await page.waitForTimeout(500);
const hidden = await page.evaluate(
  (id) => globalThis.__pracFrame.listItems().find((view) => view.id === id),
  target,
);
await page.click(`[data-prac-recall-toggle="${target}"]`);
await page.waitForTimeout(500);
const restored = await page.evaluate(
  (id) => globalThis.__pracFrame.listItems().find((view) => view.id === id),
  target,
);

await closeOverlay();
const closed = (await page.locator("[data-prac-recall]").count()) === 0;

await close();

report({
  url,
  facts: { catalogue, before, hidden, restored, closed },
  checks: {
    "Cmd/Ctrl+Alt+V opens the recall surface": catalogue.rows.length > 0,
    "the surface lists the frame catalogue": catalogue.rows.length === catalogue.views.length,
    "board-owned widgets are not listed as frame views": [
      "vscode:view:workbench.explorer.fileView",
      "vscode:view:outline",
      "vscode:view:timeline",
    ].every((id) => !catalogue.rows.includes(id)),
    "a row is selected": catalogue.selected !== null,
    "hide removes the view from screen": hidden?.hidden === true,
    "show restores it": restored?.hidden !== true,
    "Escape closes the surface": closed,
    "no prac-owned console errors":
      own("__pracFrame").length === 0 && own("prac-client-ui-frame").length === 0,
  },
  ok: "OK: the recall surface opens, lists the catalogue, hides / shows a view, and closes with Escape",
});
